'use strict';

const Queue = require('..');

describe('Queue', () => {
    it('has methods enqueue, dequeue and size', () => {
        const queue = new Queue();

        expect(typeof queue.enqueue).toBe('function');
        expect(typeof queue.dequeue).toBe('function');
        expect(typeof queue.size).toBe('function');
        expect(typeof queue.remove).toBe('function');
        expect(typeof queue.extract).toBe('function');
        expect(typeof queue.exists).toBe('function');
    });

    it('can enqueue and dequeue', () => {
        const queue = new Queue();
        const isNull = queue.dequeue();
        queue.enqueue('first');
        queue.enqueue('second');
        const two = queue.size();
        const first = queue.dequeue();

        expect(isNull).toBeNull();
        expect(two).toEqual(2);
        expect(first).toEqual('first');
    });

    it('can unshift', () => {
        const queue = new Queue();
        queue.enqueue(2);
        queue.enqueue(3);
        queue.unshift(1);

        expect(queue.size()).toEqual(3);
        expect(queue.dequeue()).toEqual(1);
        expect(queue.dequeue()).toEqual(2);
        expect(queue.dequeue()).toEqual(3);
        expect(queue.dequeue()).toEqual(null);
        expect(queue.size()).toEqual(0);
    });

    it('has an each method', () => {
        const results = [];
        const queue = new Queue();
        queue.enqueue(1);
        queue.enqueue(2);
        queue.enqueue(3);

        queue.each((val) => {
            results.push(val);
        });

        expect(results.length).toEqual(3);
        expect(results[0]).toEqual(1);
        expect(results[1]).toEqual(2);
        expect(results[2]).toEqual(3);
    });

    it('can remove from queue based on id', () => {
        const queue = new Queue();
        queue.enqueue({ data: 'first', id: 'id1' });
        queue.enqueue({ data: 'second', id: 'id2' });
        queue.enqueue({ data: 'third', id: 'id3' });
        queue.enqueue({ data: 'fourth', id: 'id2' });

        const len = queue.size();

        queue.remove('id2');

        expect(len).toEqual(4);
        expect(queue.size()).toEqual(2);
        expect(queue.dequeue()).toEqual({ data: 'first', id: 'id1' });
        expect(queue.dequeue()).toEqual({ data: 'third', id: 'id3' });
        expect(queue.size()).toEqual(0);
    });

    it('can remove from queue based on a key and id', () => {
        const queue = new Queue();
        queue.enqueue({ data: 'first', id: 'id1' });
        queue.enqueue({ data: 'second', id: 'id2' });
        queue.enqueue({ data: 'third', ex_id: 'id3' });
        queue.enqueue({ data: 'fourth', job_id: 'id2' });

        const len = queue.size();

        queue.remove('id2', 'job_id');

        expect(len).toEqual(4);
        expect(queue.size()).toEqual(3);
        expect(queue.extract('job_id', 'id2')).toEqual(null);
        expect(queue.dequeue()).toEqual({ data: 'first', id: 'id1' });
        expect(queue.dequeue()).toEqual({ data: 'second', id: 'id2' });
        expect(queue.dequeue()).toEqual({ data: 'third', ex_id: 'id3' });
        expect(queue.size()).toEqual(0);
    });

    it('can extract from queue based on a key and id', () => {
        const queue1 = new Queue();
        expect(queue1.extract()).toEqual(null);
        expect(queue1.size()).toEqual(0);

        const queue2 = new Queue();
        queue2.enqueue({ job_id: 2 });
        expect(queue2.size()).toEqual(1);
        expect(queue2.extract('job_id', 2)).toEqual({ job_id: 2 });
        expect(queue2.extract('job_id', 2)).toEqual(null);
        expect(queue2.size()).toEqual(0);
        expect(queue2.dequeue()).toEqual(null);

        const queue3 = new Queue();
        queue3.enqueue({ job_id: 2 });
        queue3.enqueue({ ex_id: 3 });
        expect(queue3.size()).toEqual(2);
        expect(queue3.extract('ex_id', 3)).toEqual({ ex_id: 3 });
        expect(queue3.extract('ex_id', 3)).toEqual(null);
        expect(queue3.size()).toEqual(1);
        expect(queue3.dequeue()).toEqual({ job_id: 2 });
        expect(queue3.dequeue()).toEqual(null);

        const queue4 = new Queue();
        queue4.enqueue({ data: 'first', id: 'id1' });
        queue4.enqueue({ data: 'second', id: 'id2' });
        queue4.enqueue({ data: 'third', ex_id: 'id3' });
        queue4.enqueue({ data: 'fourth', job_id: 'id2' });

        const len = queue4.size();

        const data = queue4.extract('id', 'id2');

        expect(len).toEqual(4);
        expect(queue4.size()).toEqual(3);
        expect(data).toEqual({ data: 'second', id: 'id2' });
        expect(queue4.dequeue()).toEqual({ data: 'first', id: 'id1' });
        expect(queue4.dequeue()).toEqual({ data: 'third', ex_id: 'id3' });
        expect(queue4.dequeue()).toEqual({ data: 'fourth', job_id: 'id2' });
    });

    it('can extract only once from a queue', () => {
        const queue = new Queue();
        queue.enqueue({ job_id: 1 });
        queue.enqueue({ job_id: 2 });
        expect(queue.size()).toEqual(2);
        expect(queue.extract('job_id', 1)).toEqual({ job_id: 1 });
        expect(queue.size()).toEqual(1);
        expect(queue.extract('job_id', 1)).toEqual(null);
    });

    it('can check for the existence of a node given a key and value', () => {
        const queue = new Queue();

        queue.enqueue({ id: 'some-random-id' });
        queue.enqueue({ id: 'example-id' });
        queue.enqueue({ id: 'some-other-id' });

        expect(queue.exists('id', 'example-id')).toEqual(true);
        expect(queue.exists('id', 'missing-id')).toEqual(false);
    });
});
