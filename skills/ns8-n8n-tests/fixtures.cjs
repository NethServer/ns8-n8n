const { randomUUID } = require('node:crypto');

function workflowFixture(state, failed = false) {
  const node = (name, type, version, position, parameters) => ({
    id: randomUUID(), name, type: 'n8n-nodes-base.' + type, typeVersion: version,
    position, parameters,
  });
  const next = (name) => ({ main: [[{ node: name, type: 'main', index: 0 }]] });
  const manual = node('Manual', 'manualTrigger', 1, [0, 0], {});
  const nodes = [manual];
  const connections = {};
  if (failed) {
    nodes.push(node('Expected failure', 'stopAndError', 1, [260, 0],
      { errorMessage: 'Qualification intentional failure' }));
    connections.Manual = next('Expected failure');
  } else {
    const webhook = node('Webhook', 'webhook', 2, [0, 180], {
      path: state.path, httpMethod: 'GET', authentication: 'headerAuth',
      responseMode: 'lastNode', responseData: 'firstEntryJson', options: {},
    });
    webhook.webhookId = randomUUID();
    webhook.credentials = { httpHeaderAuth: state.credential };
    nodes.push(webhook,
      node('JavaScript', 'code', 2, [260, 0], {
        language: 'javaScript', jsCode: 'return [{ json: { javascript: 21 } }];',
      }),
      node('Python', 'code', 2, [520, 0], {
        language: 'pythonNative',
        pythonCode: 'value = _items[0]["json"]["javascript"]\nreturn [{"json": {"javascript": value, "python": value * 2}}]',
      }));
    connections.Manual = next('JavaScript');
    connections.Webhook = next('JavaScript');
    connections.JavaScript = next('Python');
  }
  return { name: state.path + (failed ? '-failure' : '-runners'), nodes, connections,
    active: false, settings: { executionOrder: 'v1', saveManualExecutions: true,
      saveDataErrorExecution: 'all', saveDataSuccessExecution: 'all' } };
}

module.exports = { workflowFixture };
