import { castArray } from './utils';

/**
 * An in-memory record collector,
 * useful for batch data to a certain
 * size or after a certain amount of time has passed.
 *
 * NOTE: Records are store in an immutable array to
 * be more memory efficient.
*/
export class Collector<T> {
    /** the maximum wait time to collect the batch */
    readonly size: number;
    /** the maximum batch size of the batch */
    readonly wait: number;

    private _queue: T[] = [];
    private _startTime: number|null = null;

    constructor(max: { wait: number, size: number }) {
        this.wait = max.wait;
        this.size = max.size;
    }

    /**
     * Add a record, or records, to the in-memory queue.
    */
    add(record: T): void;
    add(records: T[]): void;
    add(_records: T[]|T): void {
        if (!this._queue.length) {
            this._startTime = Date.now();
        }

        const r: T[] = [];

        const records = castArray<T>(_records);
        this._queue = r.concat(this._queue, records);
    }

    /**
     * Get the batch of data if it is full or has exceeded the time threshold.
     *
     * @returns null if the batch isn't ready
     * @returns the a batch of records, less or equal to the max size
    */
    getBatch(): T[]|null {
        const isValid = this._checkTime();
        if (isValid && this._queue.length < this.size) return null;

        const records = this._queue.splice(0, this.size);

        this._queue = this._queue.slice();
        this._startTime = null;

        return records;
    }

    /**
     * Flush all of the records in the queue.
     *
     * **NOTE:** This can potentially return more records than
     * specified than the max size.
    */
    flushAll() {
        const records = this._queue.slice();
        this._queue.length = 0;
        return records;
    }

    private _checkTime(): boolean {
        if (this._startTime == null) return true;

        const invalidAt = this._startTime + this.wait;
        return Date.now() < invalidAt;
    }
}
