// main entry point for application
'use strict';

require('newrelic');

var cluster = require('cluster');
var config = require('./config');
var logger = require('./logger');
var poller = require('./listener/poller');
var format = require('util').format;
var express = require('express');
var routes = require('./listener/routes');
const basicAuth = require('express-basic-auth');
var bodyParser = require('body-parser');

var consumer = process.argv[2]; // if an argument is passed, it will be taken as the consumer to use

if (cluster.isMaster) {
  // Check config settings
  if(!config.RALLY_API_KEY) {
    logger.fatal('RALLY_API_KEY environment variable is missing!');
    process.exit(1);
  }

  // Fork workers.
  var numCPUs = config.NUM_WORKERS || require('os').cpus().length;
  logger.info(format("Starting master process with %s workers",numCPUs));
  for (var i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
  	logger.info(format("worker %s died",worker.process.pid));
  });

} else {

   // create Express application for creating webhooks for rally
    var app = express();


    // load routes
    app.use(bodyParser.json());
    app.use('/', routes);

    // global error handler
    app.use(function(err, req, res, next){
        logger.error(err);
        if (res.headersSent) return next(err);
        res.status(500).json({status:'error'});
    });

    // start the server
    app.listen(config.PORT, function() {
        logger.info("Application started, listening on port", config.PORT);
    });

    // start polling the external queue
    poller.start(consumer);

}

