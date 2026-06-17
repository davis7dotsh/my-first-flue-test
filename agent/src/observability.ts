import { observe, type FlueEvent } from '@flue/runtime';

const terminalEvents = new Set([
	'agent_start',
	'agent_end',
	'idle',
	'submission_settled',
	'turn',
	'tool',
	'operation',
	'task',
	'compaction'
]);

function sanitizedEvent(event: FlueEvent) {
	return {
		message: 'flue_activity',
		type: event.type,
		timestamp: event.timestamp,
		eventIndex: event.eventIndex,
		instanceId: 'instanceId' in event ? event.instanceId : undefined,
		dispatchId: 'dispatchId' in event ? event.dispatchId : undefined,
		operationId: 'operationId' in event ? event.operationId : undefined,
		turnId: 'turnId' in event ? event.turnId : undefined,
		durationMs:
			'durationMs' in event && typeof event.durationMs === 'number' ? event.durationMs : undefined,
		isError: 'isError' in event && event.isError === true
	};
}

observe((event) => {
	if (!terminalEvents.has(event.type)) {
		return;
	}

	const payload = sanitizedEvent(event);
	const serialized = JSON.stringify(payload);
	if (payload.isError) {
		console.error(serialized);
	} else {
		console.log(serialized);
	}
});
