'use strict';

const { MapProcessor } = require('../../../dist');

class SimpleMap extends MapProcessor {
    map(data) {
        data.touchedAt = new Date().toISOString();
        return data;
    }
}

module.exports = SimpleMap;
