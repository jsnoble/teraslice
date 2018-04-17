'use strict';

const moment = require('moment');
const dateMath = require('datemath-parser');
const Promise = require('bluebird');

const dateFormat = require('../../../utils/date_utils').dateFormat;
const fieldsQuery = require('../../../utils/api_utils').fieldsQuery;

module.exports = function (logger, req, startingQuery, searchFn, defaults) {
    let query = startingQuery || '';
    const body = { query: { bool: { must: [] } } };
    const queryLogic = body.query.bool.must;
    const size = req.query.size || 10000;
    const from = req.query.from;
    const sort = req.query.sort || '_updated:desc';
    const fields = fieldsQuery(req.query, defaults);
    const dateField = req.query.date_field || '_updated';
    const start = req.query.start;
    const end = req.query.end;

    if (req.query.q) {
        if (query.length > 0) {
            query = `${query} AND ${req.query.q}`;
        } else {
            query = `${req.query.q}`;
        }
    }

    if (query.length > 0) {
        queryLogic.push({
            query_string: {
                default_field: '',
                query
            }
        });
    }

    if (start || end) {
        const rangeQuery = prepareDateRange(start, end);
        if (rangeQuery.error) return Promise.reject(rangeQuery.error);
        queryLogic.push(rangeQuery);
    }


    function parseDate(date) {
        try {
            return moment(dateMath.parse(date)).format(dateFormat);
        } catch (err) {
            return null;
        }
    }

    function prepareDateRange(_start, _end) {
        let startTime;
        let endTime;
        if (_start) startTime = parseDate(_start);
        if (_end) endTime = parseDate(_end);

        // Validation logic
        if (_start && !startTime) return { error: `start query parameter ${_start} cannot be converted to a proper date` };
        if (_end && !endTime) return { error: `end query parameter ${_end} cannot be converted to a proper date` };
        if (_start && _end) {
            if (moment(startTime).isAfter(moment(endTime))) return { error: 'Cannot have start time that is later than end time' };
        }

        const rangeQuery = {
            range: {}
        };

        rangeQuery.range[dateField] = {};

        if (startTime && endTime) {
            rangeQuery.range[dateField].gte = startTime;
            rangeQuery.range[dateField].lte = endTime;
            return rangeQuery;
        }
        if (startTime) {
            rangeQuery.range[dateField].gte = startTime;
            return rangeQuery;
        }
        if (endTime) {
            rangeQuery.range[dateField].lte = endTime;
            return rangeQuery;
        }
    }

    // wrapping to make sure searchFn is a promise
    return Promise.resolve()
        .then(() => searchFn(body, from, size, sort, fields));
};
