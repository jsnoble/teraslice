import 'jest-extended'; // require for type definitions
import {
    DataEntity,
    BatchProcessor,
    newTestExecutionConfig,
    TestContext,
    WorkerContext
} from '../../src';

describe('BatchProcessor', () => {
    class ExampleBatchProcessor extends BatchProcessor<object> {
        public async onBatch(batch: DataEntity[]): Promise<DataEntity[]> {
            batch.push(new DataEntity({
                hi: 'there'
            }));
            return batch;
        }
    }

    let operation: ExampleBatchProcessor;

    beforeAll(() => {
        const context = new TestContext('teraslice-operations');
        const exConfig = newTestExecutionConfig();
        exConfig.operations.push({
            _op: 'example-op',
        });
        const opConfig = exConfig.operations[0];
        operation = new ExampleBatchProcessor(context as WorkerContext, opConfig, exConfig);
    });

    describe('->onBatch', () => {
        it('should resolve the data entities which are passed in', async () => {
            const input = DataEntity.makeArray([
                {
                    hello: 'there',
                },
            ]);

            const results = await operation.onBatch(input);
            expect(results).toBeArrayOfSize(2);
        });
    });

    describe('->handle', () => {
        it('should resolve to a data entity list', async () => {
            const input = DataEntity.makeArray([
                {
                    hello: 'there',
                },
            ]);

            const output = await operation.handle(input);
            const results = output;
            expect(results).toBeArrayOfSize(2);
        });
    });
});
