'use strict';

var resolve = require('path').resolve,
    _ = require('lodash'),
    helper = require('../lib/consumer_helper'),
    Promise = require('bluebird'),
    config = require(resolve(__dirname, '../config')),
    rallyUtil = require('../lib/rally_util')(config);

const APPLY_CONCURRENCY = 10;

var ApplyConsumer = function () {
}

ApplyConsumer.prototype.applyConsumer = function (consumerType) {
    var workspaces = _.values(config.applyConsumerConfig.workspaces);
    var consumerConfig = config.applyConsumerConfig.consumers[consumerType];
    var consumer = require(`../consumers/${consumerType}.js`);
    var logger = helper.getLogger(consumerType);
    var errors = [];

    return new Promise.map(workspaces, function(workspace){
        logger.info(`Begin applying consumer ${consumerType} on workspace ${workspace.name}`);
        return queryRallyObjects(workspace.id, consumerConfig.query, consumerConfig.type)
            .map(function(userStoryOrDefect){
                logger.info(`Processing rally object ${userStoryOrDefect["FormattedID"]}`);
                return callConsumerFunction(consumer, workspace.id, userStoryOrDefect)
                    .catch(function(e){
                        logger.error(e, {
                            consumerType: consumerType,
                            workspace: workspace.name,
                            rallyObj: userStoryOrDefect["FormattedID"]
                        });
                        errors.push(e);
                    });
            }, {concurrency: APPLY_CONCURRENCY})
            .then(function(){
                logger.info(`Finished applying consumer ${consumerType} on workspace ${workspace.name}`);
            });

    }).then(function(){
        logger.info(`Finished with ${errors.length} errors`);
        return (errors.length == 0);
    });

};


function queryRallyObjects(workspaceObjectID, queryString, rallyType) {
    //Get all user stories and defects from Rally
    var workspaceRef = `/workspace/${workspaceObjectID}`;
    var fetch = ["Name", "ObjectID", "FormattedID", "Project", "Owner"];
    return rallyUtil.queryUserStory(queryString, fetch, workspaceRef, rallyType);
}

function callConsumerFunction(consumer, workspaceObjectID, userStoryOrDefect){
    var obj = {
       objectId: userStoryOrDefect["ObjectID"],
       storyId: userStoryOrDefect["FormattedID"],
       storyRef: userStoryOrDefect["Name"],
       workspaceRef: `/workspace/${workspaceObjectID}`,
       projectRef: userStoryOrDefect["Project"]._ref,
       ownerRef: userStoryOrDefect["Owner"] ? userStoryOrDefect["Owner"]._ref : null
    };
    return consumer.applyHandler(obj);
}

module.exports = ApplyConsumer;

