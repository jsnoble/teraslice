import debugFn from 'debug';
import _ from 'lodash';
import NodeCache from 'node-cache';
import { EventEmitter } from 'events';
import * as i from './interfaces';
import { newMsgId } from '../utils';

const debug = debugFn('teraslice-messaging:core');

export class Core extends EventEmitter {
    public closed: boolean = false;
    protected cache: NodeCache;

    protected networkLatencyBuffer: number;
    protected actionTimeout: number;

    constructor(opts: i.CoreOptions) {
        super();

        this.networkLatencyBuffer = opts.networkLatencyBuffer || 0;
        this.actionTimeout = opts.actionTimeout;

        if (!_.isSafeInteger(this.actionTimeout) || !this.actionTimeout) {
            throw new Error('Messenger requires a valid actionTimeout');
        }

        if (!_.isSafeInteger(this.networkLatencyBuffer)) {
            throw new Error('Messenger requires a valid networkLatencyBuffer');
        }

        this.cache = new NodeCache({
            stdTTL: 30 * 60 * 1000, // 30 minutes
            checkperiod: 10 * 60 * 1000, // 10 minutes
            useClones: false,
        });

    }

    close() {
        this.closed = true;

        this.cache.flushAll();
        this.cache.close();

        this.removeAllListeners();
    }

    protected handleSendResponse(sent: i.Message, resolve: (val?: i.Message) => void, reject: (err: Error) => void) {
        if (!sent.response) {
            resolve();
            return;
        }
        debug('waiting for response from message', sent);

        const remaining = sent.respondBy - Date.now();
        const timeoutError = new Error(`Timed out after ${remaining}ms, waiting for message "${sent.eventName}"`);

        const timeout = setTimeout(() => {
            if (sent.volatile || this.closed) {
                resolve();
            } else {
                reject(timeoutError);
            }
        }, remaining);

        const responseError = new Error(`${sent.eventName} Message Response Failure`);
        return (response: i.Message) => {
            clearTimeout(timeout);

            if (response.error) {
                responseError.message += `: ${response.error}`;
                // @ts-ignore
                responseError.response = response;
                debug('message send response error', responseError);
                reject(responseError);
                return;
            }

            debug(`got response for message ${sent.eventName}`, response);
            resolve(response);
        };
    }

    protected handleResponse(eventName: string, fn: i.MessageHandler) {
        debug(`registering response handler for ${eventName}`);

        return async (msg: i.Message, callback: (msg?: i.Message) => void) => {
            const message: i.Message = Object.assign({}, msg, {
                id: newMsgId(),
                from: msg.to,
                to: msg.from,
                payload: {},
            });

            try {
                const payload = await fn(msg);
                if (payload) {
                    message.payload = payload;
                }
            } catch (err) {
                message.error = _.toString(err);
            }

            if (!msg.response) {
                return;
            }

            if (!msg.volatile) {
                const remaining = msg.respondBy - Date.now();
                await this.waitForClientReady(message.to, remaining);
            }

            debug(`responding to ${eventName} with message`, message);
            callback(message);
        };
    }

    isClientReady(clientId?: string): boolean {
        debug('isClientReady should be implemented on the server and client class', clientId);
        throw new Error('isClientReady should be implemented on the server and client class');
    }

    async waitForClientReady(clientId: string, timeout?: number): Promise<boolean> {
        if (this.isClientReady(clientId)) {
            return true;
        }

        debug(`waiting for ${clientId} to be ready`);
        await this.onceWithTimeout('ready', clientId, timeout);
        const isReady = this.isClientReady(clientId);
        if (!isReady) {
            throw new Error(`Client ${clientId} is not ready`);
        }
        return isReady;
    }

    getTimeoutWithMax(maxTimeout: number): number {
        const timeout = this.getTimeout();
        return timeout > maxTimeout ? maxTimeout : timeout;
    }

    getTimeout(timeout?: number): number {
        return (timeout || this.actionTimeout) + this.networkLatencyBuffer;
    }

    async onceWithTimeout(eventName: string, timeout?: number): Promise<any>;
    async onceWithTimeout(eventName: string, forClientId: string, timeout?: number): Promise<any>;
    async onceWithTimeout(eventName: string, ...params: any[]): Promise<any> {
        let timeoutMs: number = this.getTimeout();
        let forClientId: string|undefined;

        if (_.isNumber(params[0])) {
            timeoutMs = this.getTimeout(params[0]);
        } else if (_.isString(params[0])) {
            forClientId = params[0];
            if (_.isNumber(params[1])) {
                timeoutMs = this.getTimeout(params[1]);
            }
        }

        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.removeListener(eventName, _onceWithTimeout);
                resolve();
            }, timeoutMs);

            function _onceWithTimeout(clientId: string, param?: any) {
                if (forClientId && forClientId !== clientId) return;
                clearTimeout(timer);
                if (!param) {
                    resolve(clientId);
                } else {
                    resolve(param);
                }
            }

            this.on(eventName, _onceWithTimeout);
        });
    }
}