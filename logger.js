'use strict';

// configure logger adapter

var bunyan = require('bunyan');
var config = require('./config');
var cluster = require('cluster');

var logger = bunyan.createLogger({
    name: 'rally_webhook_consumer',
    env: config.ENV,
    worker: cluster.worker ? cluster.worker.id : 0,
    streams: [{
        stream: process.stdout,
        level: config.LOG_LEVEL
    }]
});

module.exports = logger;