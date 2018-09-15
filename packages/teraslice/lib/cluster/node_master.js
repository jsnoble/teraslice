'use strict';

const Promise = require('bluebird');
const Queue = require('@terascope/queue');
const _ = require('lodash');
const parseError = require('@terascope/error-parser');
const { Mutex } = require('async-mutex');
const messageModule = require('./services/cluster/backends/native/messaging');
const spawnAssetsLoader = require('../workers/assets/spawn');
const { safeEncode } = require('../utils/encoding_utils');

const nodeVersion = process.version;
const terasliceVersion = require('../../package.json').version;

module.exports = function module(context) {
    const logger = context.apis.foundation.makeLogger({ module: 'node_master' });
    const configWorkerLimit = context.sysconfig.teraslice.workers;
    const config = context.sysconfig.teraslice;
    const events = context.apis.foundation.getSystemEvents();
    const systemPorts = portAllocator();
    const mutex = new Mutex();

    const messaging = messageModule(context, logger);
    const host = messaging.getHostUrl();
    const isShuttingDown = false;

    logger.info(`node ${context.sysconfig._nodeName} is attempting to connect to cluster_master: ${host}`);

    function sendNodeStateNow() {
        if (isShuttingDown) return;
        const state = getNodeState();
        messaging.send({
            to: 'cluster_master',
            message: 'node:state',
            node_id: state.node_id,
            payload: state
        });
    }

    const sendNodeState = _.debounce(sendNodeStateNow, 500, { leading: false, trailing: true });

    let pendingAllocations = 0;

    function allocateWorkers(count, exConfig, fn) {
        pendingAllocations += count;
        sendNodeState();
        if (mutex.isLocked()) {
            logger.warn('waiting for allocation lock');
        }
        return mutex.runExclusive(async () => {
            pendingAllocations -= count;

            logger.info(`allocating ${count} workers...`);
            let workers = [];

            try {
                await loadAssetsIfNeeded(exConfig.job, exConfig.ex_id);
                workers = await fn();
            } catch (err) {
                throw err;
            } finally {
                sendNodeStateNow();
            }

            logger.info(`allocated ${workers.length} out of the requested ${count} workers`);
            return workers.length;
        });
    }

    function canAllocateWorkers(requestedWorkers) {
        const numOfCurrentWorkers = Object.keys(context.cluster.workers).length;
        // if there is an over allocation, send back rest to be enqueued
        if (configWorkerLimit < numOfCurrentWorkers + requestedWorkers) {
            return configWorkerLimit - numOfCurrentWorkers > 0;
        }
        return true;
    }

    messaging.registerChildOnlineHook(sendNodeState);

    messaging.register({
        event: 'network:connect',
        callback: () => {
            logger.info(`node has successfully connected to: ${host}`);
            const state = getNodeState();
            messaging.send({
                to: 'cluster_master', message: 'node:online', node_id: state.node_id, payload: state
            });
        }
    });

    messaging.register({
        event: 'network:disconnect',
        callback: () => logger.info(`node has disconnected from: ${host}`)
    });

    messaging.register({
        event: 'network:error',
        callback: err => logger.warn(`Attempting to connect to cluster_master: ${host}`, err)
    });

    messaging.register({
        event: 'cluster:execution_controller:create',
        callback: (createSlicerRequest) => {
            const createSlicerMsg = createSlicerRequest.payload;
            logger.info(`Allocating execution controller for execution ${createSlicerMsg.ex_id}`);

            allocateWorkers(1, createSlicerMsg, () => {
                const controllerContext = {
                    assignment: 'execution_controller',
                    NODE_TYPE: 'execution_controller',
                    EX: safeEncode(createSlicerMsg.job),
                    job: createSlicerMsg.job,
                    node_id: context.sysconfig._nodeName,
                    ex_id: createSlicerMsg.ex_id,
                    job_id: createSlicerMsg.job_id,
                    slicer_port: createSlicerMsg.slicer_port
                };
                logger.trace('starting a execution controller', controllerContext);
                return context.foundation.startWorkers(1, controllerContext);
            })
                .then(() => messaging.respond(createSlicerRequest))
                .catch((error) => {
                    messaging.respond(createSlicerRequest, {
                        error: parseError(error),
                    });
                });
        }
    });

    messaging.register({
        event: 'cluster:workers:create',
        callback: (createWorkerRequest) => {
            const createWorkerMsg = createWorkerRequest.payload;
            const requestedWorkers = createWorkerMsg.workers;
            logger.info(`Attempting to allocate ${requestedWorkers} workers.`);

            if (!canAllocateWorkers(requestedWorkers)) {
                logger.warn(`Worker is overallocated, maximum number of workers of ${configWorkerLimit}`);
                messaging.respond(createWorkerRequest, {
                    payload: {
                        createdWorkers: 0,
                    }
                });
                return;
            }

            allocateWorkers(requestedWorkers, createWorkerMsg, () => {
                let newWorkers = requestedWorkers;
                const numOfCurrentWorkers = Object.keys(context.cluster.workers).length;
                // if there is an over allocation, send back rest to be enqueued
                if (configWorkerLimit < numOfCurrentWorkers + requestedWorkers) {
                    newWorkers = configWorkerLimit - numOfCurrentWorkers;
                    logger.warn(`Worker allocation request would exceed maximum number of workers of ${configWorkerLimit}`);
                    logger.warn(`Reducing allocation to ${newWorkers} workers.`);
                }

                let workers = [];
                if (newWorkers > 0) {
                    logger.trace(`starting ${newWorkers} workers`, createWorkerMsg.ex_id);
                    workers = context.foundation.startWorkers(newWorkers, {
                        NODE_TYPE: 'worker',
                        EX: safeEncode(createWorkerMsg.job),
                        assignment: 'worker',
                        node_id: context.sysconfig._nodeName,
                        job: createWorkerMsg.job,
                        ex_id: createWorkerMsg.ex_id,
                        job_id: createWorkerMsg.job_id
                    });
                }

                return workers;
            })
                .then(createdWorkers => messaging.respond(createWorkerRequest, {
                    payload: {
                        createdWorkers,
                    }
                }))
                .catch(() => messaging.respond(createWorkerRequest, {
                    payload: {
                        createdWorkers: 0,
                    }
                }));
        }
    });

    messaging.register({ event: 'cluster:node:state', callback: () => sendNodeState() });

    // this fires when entire server will be shutdown
    events.once('terafoundation:shutdown', () => {
        logger.debug('Received shutdown notice from terafoundation');

        const filterFn = () => context.cluster.workers;
        const isActionCompleteFn = () => _.isEmpty(getNodeState().active);
        shutdownProcesses({}, filterFn, isActionCompleteFn, true);
    });

    messaging.register({
        event: 'cluster:execution:stop',
        callback: (networkMsg) => {
            const exId = networkMsg.ex_id;
            logger.debug('received cluster execution stop', { exId });

            const filterFn = () => _.filter(
                context.cluster.workers,
                worker => worker.ex_id === exId
            );
            function actionCompleteFn() {
                const children = getNodeState().active;
                const workers = _.filter(children, worker => worker.ex_id === exId);
                logger.debug(`waiting for ${workers.length} to stop for ex: ${exId}`);
                return workers.length === 0;
            }

            shutdownProcesses(networkMsg, filterFn, actionCompleteFn);
        }
    });

    messaging.register({
        event: 'cluster:workers:remove',
        callback: (networkMsg) => {
            const numberToRemove = networkMsg.payload.workers;
            const children = getNodeState().active;
            const startingWorkerCount = _.filter(children, worker => worker.ex_id === networkMsg.ex_id && worker.assignment === 'worker').length;
            const filterFn = () => _.filter(
                children,
                worker => worker.ex_id === networkMsg.ex_id && worker.assignment === 'worker'
            ).slice(0, numberToRemove);

            function actionCompleteFn() {
                const childWorkers = getNodeState().active;
                const currentWorkersForJob = _.filter(childWorkers, worker => worker.ex_id === networkMsg.ex_id && worker.assignment === 'worker').length;
                return currentWorkersForJob + numberToRemove <= startingWorkerCount;
            }

            shutdownProcesses(networkMsg, filterFn, actionCompleteFn);
        }
    });

    // used to find an open port for slicer
    messaging.register({
        event: 'cluster:node:get_port',
        callback: (msg) => {
            const port = systemPorts.getPort();
            logger.debug(`assigning port ${port} for new job`);
            messaging.respond(msg, { port });
        }
    });

    messaging.register({
        event: 'cluster:error:terminal',
        callback: () => {
            logger.error('terminal error in cluster_master, flushing logs and shutting down');
            logger.flush()
                .then(() => process.exit(0));
        }
    });

    messaging.register({
        event: 'child:exit',
        callback: () => sendNodeState()
    });

    function getAssetsFromJob(jobStr) {
        const job = typeof jobStr === 'string' ? JSON.parse(jobStr) : jobStr;
        return job.assets || [];
    }

    function loadAssetsIfNeeded(job, exId) {
        const assets = getAssetsFromJob(job);
        if (assets.length > 0) {
            logger.info(`node ${context.sysconfig._nodeName} is checking assets for job, exId: ${exId}`);
            return Promise.resolve().then(() => spawnAssetsLoader(assets));
        }
        return Promise.resolve();
    }

    function shutdownWorkers(signal, filterFn) {
        const allWorkersForJob = filterFn();
        _.each(allWorkersForJob, (worker) => {
            const workerID = worker.worker_id || worker.id;
            if (_.has(context.cluster.workers, workerID)) {
                const clusterWorker = context.cluster.workers[workerID];
                const processId = clusterWorker.process.pid;
                if (clusterWorker.isDead()) return;
                // if the worker has already been sent a SIGTERM signal it should send a SIGKILL
                logger.warn(`sending ${signal} to process ${processId}, assignment: ${worker.assignment}, ex_id: ${worker.ex_id}`);
                clusterWorker.kill(signal);
            }
        });
    }

    function shutdownProcesses(message, filterFn, isActionCompleteFn, onlySigKill = false) {
        const intervalTime = 200;
        const needsResponse = message.response && message.to;

        // give a little extra time to finish shutting down
        let stopTime = config.shutdown_timeout + 3000;

        if (!onlySigKill) {
            shutdownWorkers('SIGTERM', filterFn);
        }

        const stop = setInterval(() => {
            if (isActionCompleteFn()) {
                clearInterval(stop);
                if (needsResponse) messaging.respond(message);
            }
            if (stopTime <= 0) {
                clearInterval(stop);
                shutdownWorkers('SIGKILL', filterFn);
                if (needsResponse) messaging.respond(message);
            }

            stopTime -= intervalTime;
        }, intervalTime);
    }

    function portAllocator() {
        const portConfig = config.slicer_port_range;
        const dataArray = _.split(portConfig, ':');
        const start = _.toInteger(dataArray[0]);
        // range end is non-inclusive, so we need to add one
        const end = _.toInteger(dataArray[1]) + 1;
        const portQueue = new Queue();

        // shuffle all of the ports at random
        const ports = _.shuffle(_.range(start, end));
        _.forEach(ports, (i) => {
            portQueue.enqueue(i);
        });

        function getPort(preventEnqueing) {
            const port = portQueue.dequeue();
            if (!preventEnqueing) {
                portQueue.enqueue(port);
            }
            return port;
        }

        return {
            getPort
        };
    }

    function getNodeState() {
        const nodeId = context.sysconfig._nodeName;

        const state = {
            node_id: nodeId,
            hostname: context.sysconfig.teraslice.hostname,
            pid: process.pid,
            node_version: nodeVersion,
            teraslice_version: terasliceVersion,
            total: context.sysconfig.teraslice.workers,
            state: 'connected'
        };

        const clusterWorkers = context.cluster.workers;
        const active = [];

        _.forOwn(clusterWorkers, (worker) => {
            const child = {
                worker_id: worker.id,
                assignment: worker.assignment,
                pid: worker.process.pid
            };

            if (worker.ex_id) {
                child.ex_id = worker.ex_id;
            }

            if (worker.job_id) {
                child.job_id = worker.job_id;
            }

            if (worker.assets) {
                child.assets = worker.assets.map(asset => asset.id);
            }

            active.push(child);
        });

        state.available = state.total - active.length - pendingAllocations;
        state.active = active;

        return state;
    }

    messaging.listen({
        query: {
            node_id: context.sysconfig._nodeName
        }
    });

    if (context.sysconfig.teraslice.master) {
        const assetsPort = systemPorts.getPort(true);

        logger.debug(`node ${context.sysconfig._nodeName} is creating the cluster_master`);
        context.foundation.startWorkers(1, {
            assignment: 'cluster_master',
            assets_port: assetsPort,
            node_id: context.sysconfig._nodeName
        });

        logger.debug(`node ${context.sysconfig._nodeName} is creating assets endpoint on port ${assetsPort}`);
        context.foundation.startWorkers(1, {
            assignment: 'assets_service',
            // key needs to be called port to bypass cluster port sharing
            port: assetsPort,
            node_id: context.sysconfig._nodeName
        });
    }
};
