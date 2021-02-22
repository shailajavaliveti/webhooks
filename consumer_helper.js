'use strict';

// helper functions for writing consumer message handlers

var logger = require('../logger'),
	_ = require('lodash');

function getLogger(consumer) {
	// returns a logger object with a property for the current consumer
	return logger.child({consumer:consumer});
}

function parsePayload(payload) {
	// Converts the 'state' property of the webhook payload into a dictionary
    return _.reduce(payload.state, function(map, userstory){
      map[userstory.name] = userstory.value;
      return map;
    }, {});
}

function parseUserPayload(payload){
    return _.reduce(payload.state, function(map, user){
        map[user.name] = user.value;
        return map;
    }, {});
}

function isEmpty(obj) {
    for(var key in obj) {
        if(obj.hasOwnProperty(key))
            return false;
    }
    return true;
}

module.exports = {
	getLogger: getLogger,
	parsePayload: parsePayload,
    parseUserPayload:parseUserPayload,
    isEmpty:isEmpty
}