/**
 interface to communicate with rally's WSAPI service. It handles the api key, proxy setup, etc... for the calling
 modules.

 NOTES: rally rules for the callback function using the wsapi: callback(err, result)
 1) if you query a collection or type, you get the collection from result.Results
 2) if you query using ref, the returned item is just result
 3) if you create or update an item, the returned item is in result.Object
 4) if you add to a collection, the returned collection is in X: we arent returning anything during adds or removes

 @module lib
 @class lib.rally_util
 */
module.exports = function (config) {
    var format = require('util').format,
        Promise = require('bluebird'),
        request = require('request'),
        _ = require('lodash'),
        RateLimiter = require('limiter').RateLimiter,
        async = require('async'),
        rally = require('rally'),
        refUtils = rally.util.ref,
        rallyApiKey = config.RALLY_API_KEY,
        intelProxy  = config.INTEL_PROXY;

        restApi = rally({
            apiKey: rallyApiKey,
            requestOptions: {
                jar: true, //this allows the permissions stuff to work (has to do with cookies?)
                proxy: intelProxy,
                pool: {maxSockets: 2000}
            }
        }),
        requestQueue = async.queue(function (fn, callback) {
            //only allows 2000 concurrent requests to rally. core "net" module broke when a lot were sent at once
            fn().then(function () {
                callback();
            });
        }, 2000),
        lookbackRequestQueue = async.queue(function (fn, callback) {
            //only allows 2000 concurrent requests to lookback
            fn().then(function () {
                callback();
            });
        }, 2000),
        lookbackRateLimiter = new RateLimiter(500, 'second'),
        areSameRefs = function (ref1, ref2) {
            return refUtils.getRelative(ref1) === refUtils.getRelative(ref2);
        },
        rallyUtil = {};

    // PROXY AND QUEUE THESE BECAUSE APPARENTLY THE LIBRARIES CANT QUEUE REQUESTS
    _.each(['query', 'create', 'update', 'del', 'add', 'remove'], function (funcName) {
        var oldFunc = restApi[funcName].bind(restApi);
        restApi[funcName] = function (opts, callback) {
            var outerDeferred = Promise.defer();
            requestQueue.push(function () {
                var innerDeferred = Promise.defer();
                oldFunc(opts, function (error, result) {
                    if (callback) callback(error, result);
                    if (error) outerDeferred.reject(error);
                    else outerDeferred.resolve(result);
                    innerDeferred.resolve();
                });
                return innerDeferred.promise;
            });
            return outerDeferred.promise;
        };
    });



    /*********************************************** LOOKBACK Functions *********************************************/
    function _queueLookback(fn) {
        var outerDeferred = Promise.defer();
        lookbackRateLimiter.removeTokens(1, function () {
            lookbackRequestQueue.push(function () {
                return fn()
                    .then(function (result) {
                        outerDeferred.resolve(result);
                    })
                    .catch(function (error) {
                        outerDeferred.reject(error);
                    });
            });
        });
        return outerDeferred.promise;
    }

    function _loadLookbackPage(opts) {
        return _queueLookback(function () {
            return new Promise(function (resolve, reject) {
                var queryString = [], url;
                var urlPar = "https://rally1.rallydev.com/analytics/v2.0/service/rally%s/artifact/snapshot/query.js?%s";
                try {
                    if (typeof opts.find === 'object') queryString.push('find=' + JSON.stringify(opts.find));
                    if (opts.fields instanceof Array) queryString.push('fields=' + JSON.stringify(opts.fields));
                    if (opts.hydrate instanceof Array) queryString.push('hydrate=' + JSON.stringify(opts.hydrate));
                    if (typeof opts.start === 'number') queryString.push('start=' + opts.start);
                    if (typeof opts.pagesize === 'number') queryString.push('pagesize=' + opts.pagesize);
                    if (workspaceRef) {
                        url = format(urlPar, workspaceRef, queryString.join('&'));
                    } else {
                        url = format(urlPar, queryString.join('&'));
                    }
                }
                catch (e) {
                    reject(e);
                    return;
                }
                request({
                    url: url,
                    proxy: rallyUtil.proxyURL,
                    headers: {ZSESSIONID: rallyApiKey}
                }, function (error, response, body) {
                    if (!error && response.statusCode == 200) {
                        try {
                            resolve(JSON.parse(body));
                        }
                        catch (e) {
                            reject(e);
                        }
                    }
                    else {
                        debugger;
                        reject("could not get " + url + ', error:' + error + ', body:' + body);
                    }
                });
            });
        });
    }

    /**
     only accepts find, fields, and hydrate options
     */
    rallyUtil.queryLookback = function (opts) {
        var allResults = [];

        function nextPage(start, pagesize) {
            opts.start = start;
            opts.pagesize = pagesize;
            return _loadLookbackPage(opts).then(function (data) {
                if (data.Errors && data.Errors.length) {
                    return Promise.reject(data.Errors);
                }
                else if (data.Results.length) {
                    [].push.apply(allResults, data.Results);
                    return nextPage(start + pagesize, pagesize);
                }
                else {
                    return allResults;
                }
            });
        }

        return nextPage(0, 20000);
    };

    /*********************************************** Generic Functions *********************************************/
    rallyUtil.query = function (opts) {
        var workspace = workspaceRef ? {workspace: workspaceRef} : {};
        return restApi.query({
                type: opts.type,
                start: (typeof opts.start !== 'undefined') ? opts.start : 1,
                pageSize: (typeof opts.pageSize !== 'undefined') ? opts.pageSize : 200,
                limit: (typeof opts.limit !== 'undefined') ? opts.limit : Infinity,
                order: (typeof opts.order !== 'undefined') ? opts.order : undefined,
                fetch: opts.fetch || [],
                query: (typeof opts.query !== 'undefined') ? opts.query : undefined,
                scope: opts.scope || workspace
            })
            .then(function (result) {
                return result.Results;
            });
    };
    rallyUtil.get = function (ref, fetch) {
        return restApi.query({
            ref: ref,
            fetch: fetch || [],
            scope: workspaceRef ? {workspace: workspaceRef} : {}
        });
    };
    rallyUtil.create = function (type, data, fetch) {
        return restApi.create({
                type: type,
                data: data,
                fetch: fetch,
                scope: workspaceRef ? {workspace: workspaceRef} : {}
            })
            .then(function (result) {
                return result.Object;
            });
    };
    rallyUtil.update = function (ref, data, fetch) {
        return restApi.update({
                ref: ref,
                data: data,
                fetch: fetch || [],
                scope: workspaceRef ? {workspace: workspaceRef} : {}
            })
            .then(function (result) {
                return result.Object;
            });
    };
    rallyUtil.del = function (ref) {
        return restApi.del({
            ref: ref,
            scope: workspaceRef ? {workspace: workspaceRef} : {}
        });
    };

    /*********************************************** User Story Functions *********************************************/
    rallyUtil.createDefectOrUserStory = function (type,title, description, projectRef, workspaceRef,iterationRef) {
        return restApi.create({
            type: type, //the type to create
            data: {
                Name: title, //the data with which to populate the new object
                Description: description,
                Iteration: iterationRef,
                Project: projectRef
            },
            fetch: ['FormattedID', 'Name','_ref', 'ObjectID','_refObjectName'],  //the fields to be returned on the created object
            scope: {
                workspace: workspaceRef
            },
            requestOptions: {} //optional additional options to pass through to request
        });
    };

    rallyUtil.createTask = function (title, projectRef, workspaceRef,userstoryRef,ownerRef,storyEstimate) {
        return restApi.create({
            type: 'task', //the type to create
            data: {
                Name: title, //the data with which to populate the new object
                Estimate:storyEstimate,
                WorkProduct:userstoryRef,
                Project: projectRef,
                Owner:ownerRef
            },
            fetch: ['Name','WorkProduct','Iteration','Estimate','Owner'],  //the fields to be returned on the created object
            scope: workspaceRef ? {workspace: workspaceRef} : {}
        }).then(function(result){
            return result.Object;
        });
    };
    rallyUtil.queryRandomUserStory = function (queryString, fetch, workspaceRef) {
        return restApi.query({
            type: 'hierarchicalrequirement',
            limit: 1,
            pageSize: 1,
            fetch: typeof fetch != 'undefined' ? fetch : ['true'],
            query: queryString,
            scope: workspaceRef ? {workspace: workspaceRef} : {}
        }).then(function (result) {
            return result.Results;
        });
    };
    rallyUtil.queryUserStoryOrDefect = function (queryString, fetch, workspaceRef, type) {
        return restApi.query({
            type:  (type)? type : 'hierarchicalrequirement',
            limit: Infinity,
            fetch: typeof fetch != 'undefined' ? fetch : ['true'],
            query: queryString,
            scope: workspaceRef ? {workspace: workspaceRef} : {}
        }).then(function (result) {
            return result.Results;
        });
    };
    rallyUtil.queryUserStory = function (queryString, fetch, workspaceRef, type) {
        return restApi.query({
            type:  (type)? type : 'hierarchicalrequirement',
            limit: Infinity,
            fetch: typeof fetch != 'undefined' ? fetch : ['true'],
            query: queryString,
            scope: workspaceRef ? {workspace: workspaceRef} : {}
        }).then(function (result) {
            return result.Results;
        });
    };
    rallyUtil.queryTestCase = function (queryString, fetch, workspaceRef) {
        return restApi.query({
            type:  'testcase',
            limit: Infinity,
            fetch: typeof fetch != 'undefined' ? fetch : ['true'],
            query: queryString,
            scope: workspaceRef ? {workspace: workspaceRef} : {}
        }).then(function (result) {
            return result.Results;
        });
    };
    rallyUtil.queryTestCases = function (testcaseRef, workspaceRef) {
        return restApi.query({
            ref: testcaseRef,
            limit: 1000,
            fetch: ['Name', 'WorkProduct', 'ObjectID','LastVerdict'],
            scope: workspaceRef ? {workspace: workspaceRef} : {}
        }).then(function (result) {
            return result.Results;
        });
    };
    rallyUtil.queryTasks = function (taskRef,workspaceRef) {
        return restApi.query({
            ref: taskRef,
            limit: 1000,
            fetch: ['Name', 'WorkProduct', 'ObjectID','Estimate','State','Blocked'],
            scope: workspaceRef ? {workspace: workspaceRef} : {}
        }).then(function (result) {
            return result.Results;
        });
    };
    rallyUtil.queryReleases = function (queryString,  projectRef, workspaceRef) {
        return restApi.query({
            type: 'Release',
            limit: Infinity,
            fetch: ["Name","ObjectID","RevisionHistory","_objectVersion","Project", "_rallyAPIMajor", "_rallyAPIMinor",
                "_refObjectUUID","_type","ReleaseDate","ReleaseStartDate"],
            query: queryString,
            scope: projectRef ? {project: projectRef, down: true,up: false}:{workspace: workspaceRef}
        }).then(function (result) {
            return result.Results;
        });
    };

    rallyUtil.updateUserStoryOrDefect = function (storyRef, data, workspaceRef) {
        return restApi.update({
            ref: storyRef,
            data: data,
            fetch: ['Name', 'FormattedID', 'Release', 'Project', 'ObjectID', 'Tasks', 'c_Requestor','c_taskresize'],
            scope: workspaceRef ? {workspace: workspaceRef} : {}
        }).then(function (result) {
            return result.Object;
        }).catch(function(err){
            return err;
        });
    };

    rallyUtil.updateTask = function (taskRef, data, workspaceRef) {
        return restApi.update({
            ref: taskRef,
            data: data,
            fetch: ['Name','WorkProduct','Iteration','Estimate', 'Owner'],
            scope: workspaceRef ? {workspace: workspaceRef} : {}
        }).then(function (result) {
            return result.Object;
        });
    };

    rallyUtil.deleteTasks = function (taskRef, workspaceRef) {
            return restApi.del({
                ref: taskRef,
                scope: { workspace: workspaceRef }
            });
    };

    rallyUtil.queryRevisionHistory = function (revHistoryRef,workspaceRef) {
        return restApi.query({
            ref: revHistoryRef,
            fetch: ['Revisions'],
            scope: workspaceRef ? {workspace: workspaceRef} : {}
        }).then(function (result) {
            return result;
        });
    };

    rallyUtil.queryRevisions = function (revRef,workspaceRef) {
        return restApi.query({
            ref: revRef,
            limit: 1000,
            fetch: ['ObjectID', 'Description', 'User'],
            scope: workspaceRef ? {workspace: workspaceRef} : {}
        }).then(function (result) {
            return result;
        });
    };

    rallyUtil.queryWorkspaces = function (subscriptionRef,workspaceRef) {
        return restApi.query({
            ref: subscriptionRef,
            limit: 1000,
            fetch: ['ObjectID'],
            scope: workspaceRef ? {workspace: workspaceRef} : {}
        }).then(function (result) {
            return result.Results;
        });
    };

    rallyUtil.queryProject = function (ref, fetch, workspaceRef) {
        return restApi.query({
            ref: ref,
            type: 'Project',
            fetch: fetch,
            scope: workspaceRef ? {workspace: workspaceRef} : {}
        }).then(function (result) {
            return result;
        });
    };

    return rallyUtil;
};
