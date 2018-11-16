import { set } from 'lodash';
import {
    ExecutionConfig,
    makeJobSchema,
    TestContext,
    ConnectionConfig,
    JobConfig,
    validateJobConfig,
    ExecutionContextConfig,
    Assignment,
} from '@terascope/job-components';
import {
    ExecutionContext,
    Context,
    Client,
    Clients,
    TestMode
} from './interfaces';

export default abstract class BaseTestHarness {
    protected abstract executionContext: ExecutionContext;
    protected abstract context: Context;

    private testMode: TestMode;
    private clients: Clients = {};

    constructor(testMode: TestMode) {
        this.testMode = testMode;
    }

    async setClients(clients: Client[] = []) {
        clients.forEach((clientConfig) => {
            const { client, type, endpoint = 'default' } = clientConfig;

            if (!type || (typeof type !== 'string')) throw new Error('you must specify a type when setting a client');

            this.clients[`${type}:${endpoint}`] = client;
            set(this.context, ['sysconfig', 'terafoundation', 'connectors', type, endpoint], {});
        });

        this.context.apis.foundation.getConnection = this._getConnection.bind(this);
        this.context.foundation.getConnection = this._getConnection.bind(this);
    }

    async initialize() {
    }

    async shutdown() {
        this.clients = {};
    }

    protected makeContextConfig(job: JobConfig): ExecutionContextConfig {
        const isSlicer = this.testMode === TestMode.Slicer;
        const context = new TestContext(`${this.testMode}-test:${job.name}`);
        context.assignment = isSlicer ? Assignment.ExecutionController : Assignment.Worker;

        const jobSchema = makeJobSchema(context);
        const executionConfig = validateJobConfig(jobSchema, job) as ExecutionConfig;
        return {
            context,
            executionConfig,
        };
    }

    private _getConnection(config: ConnectionConfig) {
        const { type, endpoint } = config;
        const client = this.clients[`${type}:${endpoint}`];
        if (!client) throw new Error(`No client was found at type ${type}, endpoint: ${endpoint}`);
        return { client };
    }

}
