import 'jest-extended';

import bluebird from 'bluebird';
import findPort from './helpers/find-port';
import * as core from '../src/messenger';
import {
    formatURL,
    newMsgId,
    ExecutionController
} from '../src';

describe('ExecutionController', () => {
    describe('->Client', () => {
        describe('when constructed without a executionControllerUrl', () => {
            it('should throw an error', () => {
                expect(() => {
                    // @ts-ignore
                    new ExecutionController.Client({});
                }).toThrowError('ExecutionController.Client requires a valid executionControllerUrl');
            });
        });

        describe('when constructed without a workerId', () => {
            it('should throw an error', () => {
                expect(() => {
                    // @ts-ignore
                    new ExecutionController.Client({
                        executionControllerUrl: 'example.com'
                    });
                }).toThrowError('ExecutionController.Client requires a valid workerId');
            });
        });

        describe('when constructed with an invalid executionControllerUrl', () => {
            let client: ExecutionController.Client;

            beforeAll(() => {
                client = new ExecutionController.Client({
                    executionControllerUrl: 'http://idk.example.com',
                    workerId: 'hello',
                    actionTimeout: 1000,
                    connectTimeout: 1000,
                    socketOptions: {
                        reconnection: false,
                    }
                });
            });

            it('start should throw an error', () => {
                const errMsg = /^Unable to connect to execution controller/;
                return expect(client.start()).rejects.toThrowError(errMsg);
            });
        });
    });

    describe('->Server', () => {
        describe('when constructed without a valid workerDisconnectTimeout', () => {
            it('should throw an error', () => {
                expect(() => {
                    // @ts-ignore
                    new ExecutionController.Server({
                        actionTimeout: 1,
                        networkLatencyBuffer: 0,
                    });
                }).toThrowError('ExecutionController.Server requires a valid workerDisconnectTimeout');
            });
        });
    });

    describe('Client & Server', () => {
        let client: ExecutionController.Client;
        let server: ExecutionController.Server;
        const workerId: string = newMsgId();
        const executionFinishedFn: core.ClientEventFn = jest.fn();

        beforeAll(async () => {
            const slicerPort = await findPort();
            const executionControllerUrl = formatURL('localhost', slicerPort);
            server = new ExecutionController.Server({
                port: slicerPort,
                networkLatencyBuffer: 0,
                actionTimeout: 1000,
                workerDisconnectTimeout: 3000,
            });

            await server.start();

            client = new ExecutionController.Client({
                workerId,
                executionControllerUrl,
                networkLatencyBuffer: 0,
                actionTimeout: 1000,
                connectTimeout: 1000,
                socketOptions: {
                    reconnection: false,
                },
            });

            client.onExecutionFinished(executionFinishedFn);

            await client.start();
        });

        afterAll(async () => {
            await server.shutdown();
            await client.shutdown();
        });

        describe('when calling start on the client again', () => {
            it('should not throw an error', () => {
                return expect(client.start()).resolves.toBeNil();
            });
        });

        it('should have no active workers', () => {
            expect(server.activeWorkers).toBeArrayOfSize(0);
        });

        it('should not call client.onExecutionFinished', () => {
            expect(executionFinishedFn).not.toHaveBeenCalled();
        });

        describe('when the client is ready', () => {
            beforeAll((done) => {
                server.onClientAvailable(() => { done(); });
                client.sendAvailable();
            });

            it('should have one client connected', async () => {
                expect(server.availableClientCount).toEqual(1);
                expect(server.onlineClientCount).toEqual(1);
            });

            describe('when sending worker:slice:complete', () => {
                describe('when the slice succeed', () => {
                    it('should respond with a slice recorded and emit slice succeeds', () => {
                        const sliceComplete = jest.fn();
                        server.onSliceSuccess(sliceComplete);
                        return client.sendSliceComplete({
                            slice: {
                                slicer_order: 0,
                                slicer_id: 1,
                                request: {},
                                slice_id: 'success-slice-complete',
                                _created: 'hello'
                            },
                            analytics: {
                                time: [],
                                memory: [],
                                size: []
                            },
                        })
                        .then(async (msg) => {
                            await bluebird.delay(100);
                            return msg;
                        })
                        .then((msg) => {
                            expect(sliceComplete).toHaveBeenCalled();
                            if (msg == null) {
                                expect(msg).not.toBeNull();
                                return;
                            }
                            expect(msg.payload).toEqual({
                                slice_id: 'success-slice-complete',
                                recorded: true,
                            });
                            expect(server.queue.exists('workerId', workerId)).toBeFalse();
                        });
                    });
                });

                describe('when the slice fails', () => {
                    it('should respond with a slice recorded and emit slice failure', () => {
                        const sliceFailure = jest.fn();
                        server.onSliceFailure(sliceFailure);
                        return client.sendSliceComplete({
                            slice: {
                                slicer_order: 0,
                                slicer_id: 1,
                                request: {},
                                slice_id: 'failure-slice-complete',
                                _created: 'hello'
                            },
                            analytics: {
                                time: [],
                                memory: [],
                                size: []
                            },
                            error: 'hello'
                        })
                        .then(async (msg) => {
                            await bluebird.delay(100);
                            return msg;
                        })
                        .then((msg) => {
                            expect(sliceFailure).toHaveBeenCalled();
                            if (msg == null) {
                                expect(msg).not.toBeNull();
                                return;
                            }
                            expect(msg.payload).toEqual({
                                slice_id: 'failure-slice-complete',
                                recorded: true,
                            });
                            expect(server.queue.exists('workerId', workerId)).toBeFalse();
                        });
                    });
                });

                describe('when the slice is double recorded', () => {
                    it('should respond with a duplicate message', () => {
                        const onSliceSuccessFn = jest.fn();
                        server.onSliceSuccess(onSliceSuccessFn);
                        const slice = {
                            slice: {
                                slicer_order: 0,
                                slicer_id: 1,
                                request: {},
                                slice_id: 'duplicate-slice-complete',
                                _created: 'hello'
                            },
                            analytics: {
                                time: [],
                                memory: [],
                                size: []
                            },
                        };

                        return client.sendSliceComplete(slice)
                            .then(() => client.sendSliceComplete(slice))
                            .then(async (msg) => {
                                await bluebird.delay(100);
                                return msg;
                            })
                            .then((msg) => {
                                if (msg == null) {
                                    expect(msg).not.toBeNull();
                                    return;
                                }
                                expect(msg.payload).toEqual({
                                    slice_id: 'duplicate-slice-complete',
                                    recorded: true,
                                    duplicate: true,
                                });
                                expect(onSliceSuccessFn).toHaveBeenCalledTimes(1);
                                expect(server.queue.exists('workerId', workerId)).toBeFalse();
                            });
                    });
                });
            });

            describe('when receiving finished', () => {
                beforeAll((done) => {
                    client.onExecutionFinished(() => { done(); });
                    server.sendExecutionFinishedToAll('some-ex-id');
                });

                it('should call client.onExecutionFinished', () => {
                    expect(executionFinishedFn).toHaveBeenCalled();
                });
            });

            describe('when receiving execution:slice:new', () => {
                describe('when the client is set as available', () => {
                    it('should resolve with correct messages', async () => {
                        const newSlice = {
                            slicer_order: 0,
                            slicer_id: 1,
                            request: {},
                            slice_id: 'client-slice-complete',
                            _created: 'hello'
                        };

                        const stopAt = Date.now() + 2000;

                        const slice = client.waitForSlice(() => (Date.now() - stopAt) > 0);

                        await bluebird.delay(500);

                        expect(server.queue.exists('workerId', workerId)).toBeTrue();

                        const id = server.dequeueWorker(newSlice);
                        if (!id) {
                            expect(id).not.toBeNull();
                            return;
                        }
                        const dispatchedPromise = server.dispatchSlice(newSlice, id);

                        const dispatched = await dispatchedPromise;
                        await expect(slice).resolves.toEqual(newSlice);
                        expect(dispatched).toBeTrue();

                        expect(server.activeWorkers).toBeArrayOfSize(1);

                        await client.sendSliceComplete({
                            slice: newSlice,
                            analytics: {
                                time: [],
                                memory: [],
                                size: []
                            }
                        });

                        await bluebird.delay(100);

                        expect(server.activeWorkers).toBeArrayOfSize(0);
                    });
                });

                describe('when the client is set as unavailable', () => {
                    beforeAll(async () => {
                        await client.sendUnavailable();
                    });

                    it('should reject with the correct error messages', () => {
                        const newSlice = {
                            slicer_order: 0,
                            slicer_id: 1,
                            request: {},
                            slice_id: 'client-slice-complete',
                            _created: 'hello'
                        };

                        const id = server.dequeueWorker(newSlice);
                        expect(id).toBeNull();
                    });
                });
            });
        });
    });
});
