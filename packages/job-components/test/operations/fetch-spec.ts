import { newTestJobConfig, TestContext } from '@terascope/teraslice-types';
import 'jest-extended'; // require for type definitions
import { Fetcher } from '../../src';

describe('Fetch Operation Base Class', () => {
    describe('when constructed', () => {
        let operation: Fetcher;

        beforeAll(() => {
            const context = new TestContext('teraslice-operations');
            const jobConfig = newTestJobConfig();
            jobConfig.operations.push({
                _op: 'example-op',
            });
            const opConfig = jobConfig.operations[0];
            const logger = context.apis.foundation.makeLogger('job-logger');
            operation = new Fetcher(context, jobConfig, opConfig, logger);
        });

        describe('->fetch', () => {
            it('should resolve an empty array', () => {
                return expect(operation.fetch()).resolves.toBeArrayOfSize(0);
            });
        });
    });
});