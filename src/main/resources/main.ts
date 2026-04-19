import { joinValues, toTag } from './lib/text';

const tags = [toTag('name', app.name), toTag('version', app.version)];

log.info(`Data Kit started: ${joinValues(tags)}`);
