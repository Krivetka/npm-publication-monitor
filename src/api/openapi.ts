// OpenAPI 3.1 description of the public REST API. Served as JSON at /api/v1/openapi.json
// and rendered by Swagger UI at /api/docs. The server implements exactly this contract;
// the SPA consumes it. Examples are real answers of the server: scripts/api-examples.mjs captures
// them into examples.ts, and they are attached to the document below by operationId.

import { ERROR_EXAMPLES, EXAMPLES, HEALTH_DEGRADED } from './examples.ts';

const feature = {
  type: 'object',
  description: 'One fired feature with the value that fired it, the threshold and the weight it adds to the score.',
  required: ['id', 'lane', 'weight', 'value'],
  properties: {
    id: { type: 'string', example: 'publisher_new' },
    lane: { type: 'string', enum: ['temporal', 'nominal', 'version', 'watchlist', 'registry', 'publisher', 'maintainers', 'manifest', 'versions', 'repository'] },
    weight: { type: 'number', example: 3 },
    value: { oneOf: [{ type: 'number' }, { type: 'string' }, { type: 'boolean' }, { type: 'array', items: { type: 'string' } }] },
    threshold: { type: 'number' },
    detail: { type: 'object', additionalProperties: true },
  },
} as const;

const stage1Summary = {
  type: 'object',
  required: ['prescore', 'candidate', 'features'],
  properties: {
    prescore: { type: 'number', example: 2 },
    candidate: { type: 'boolean' },
    features: { type: 'array', items: { $ref: '#/components/schemas/Feature' } },
    engine: { type: 'string', example: 'v1:0f10beb9@2026-10-14' },
  },
} as const;

const stage2Summary = {
  type: 'object',
  required: ['kind', 'versions', 'final_score', 'alert', 'features', 'enriched_at'],
  properties: {
    kind: { type: 'string', enum: ['publish', 'metadata', 'package_missing', 'error'] },
    versions: { type: 'array', items: { type: 'string' }, example: ['12.0.1'] },
    prescore: { type: 'number' },
    final_score: { type: 'number', example: 8.5 },
    alert: { type: 'boolean' },
    features: { type: 'array', items: { $ref: '#/components/schemas/Feature' } },
    enriched_at: { type: 'string', format: 'date-time' },
    engine: { type: 'string' },
  },
} as const;

const finding = {
  type: 'object',
  description: 'Manual verdict of an analyst on an event — the ground truth used by the evaluation.',
  required: ['seq', 'verdict', 'decided_at'],
  properties: {
    seq: { type: 'integer', format: 'int64' },
    verdict: { type: 'string', enum: ['confirmed', 'false_positive', 'undecided'] },
    note: { type: 'string', maxLength: 2000 },
    reference: { type: 'string', maxLength: 500, description: 'Advisory, issue or write-up that confirms the finding', example: 'GHSA-xxxx-xxxx-xxxx' },
    decided_at: { type: 'string', format: 'date-time' },
  },
} as const;

const event = {
  type: 'object',
  description: 'A journal event with the stage results attached when they exist.',
  required: ['seq', 'package', 'rev', 'deleted', 'observed_at'],
  properties: {
    seq: { type: 'integer', format: 'int64', example: 136858469 },
    package: { type: 'string', example: 'playwright-core' },
    rev: { type: 'string', example: '5730-3a9f0c…' },
    deleted: { type: 'boolean' },
    observed_at: { type: 'string', format: 'date-time' },
    observed_after: { type: ['string', 'null'], format: 'date-time', description: 'Lower bound of the moment the event appeared in the feed; null for backfilled history.' },
    stage1: { oneOf: [{ $ref: '#/components/schemas/Stage1Summary' }, { type: 'null' }] },
    stage2: { oneOf: [{ $ref: '#/components/schemas/Stage2Summary' }, { type: 'null' }] },
    finding: { oneOf: [{ $ref: '#/components/schemas/Finding' }, { type: 'null' }] },
  },
} as const;

const listParams = (extra: object[] = []) => [
  { name: 'before', in: 'query', description: 'Return events with seq strictly below this value (cursor pagination, newest first).', schema: { type: 'integer', format: 'int64' } },
  { name: 'after', in: 'query', description: 'Return events with seq strictly above this value (oldest first). Mutually exclusive with `before`.', schema: { type: 'integer', format: 'int64' } },
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 } },
  ...extra,
];

const eventList = {
  type: 'object',
  required: ['items'],
  properties: {
    items: { type: 'array', items: { $ref: '#/components/schemas/Event' } },
    next_before: { type: ['integer', 'null'], format: 'int64', description: 'Pass as `before` to fetch the next (older) page; null when exhausted.' },
  },
} as const;

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

const document = {
  openapi: '3.1.0',
  info: {
    title: 'npm Publication Monitor API',
    version: '1.1.0',
    summary: 'Read the journal, stage results, alerts and statistics of the npm publication monitor; record analyst verdicts.',
    description: [
      'The monitor reads the npm registry change feed, scores every publication on the metadata layer in two stages and stores an evidence snapshot per enriched event.',
      'This API is what the single-page dashboard uses. All read endpoints are public within the deployment; the two write operations (`PUT` and `DELETE /events/{seq}/finding`) require the analyst bearer token.',
      '',
      '### Real-time feed (WebSocket)',
      'Connect to `ws(s)://<host>/npm/api/v1/ws`. The server pushes JSON messages, one for each change:',
      '- `{"type":"event","event":Event}` — a new journal event (stage results are `null` and arrive later);',
      '- `{"type":"stage1","seq":…,"stage1":Stage1Summary}` — stage 1 found at least one feature on the event (an event without a feature gets no message);',
      '- `{"type":"stage2","seq":…,"stage2":Stage2Summary}` — stage 2 finished the event (alerts have `stage2.alert = true`);',
      '- `{"type":"status","status":Status}` — pipeline status, every 10 s;',
      '- `{"type":"hello","last_seq":…}` — first message after connect, the newest seq the server has sent to its clients, so the client can backfill with `GET /events?after=`.',
      'Clients send nothing; the connection is read-only. Reconnect with back-off; after a reconnect the client reads what it missed over REST (`GET /events?after=`).',
      '',
      '### Conventions',
      '- **Versioning:** the major version is in the path (`/api/v1`); additions are backward compatible, a breaking change gets a new path. See `documentation/api/reference/versioning.md`.',
      '- **Errors:** every error is `{"error": "<message>"}` with a 4xx or 5xx status; the message names the parameter that was rejected.',
      '- **Pagination:** lists of events use a cursor (`before`, `after`, `limit`) and return `next_before`.',
      '- **Time:** ISO 8601 in UTC. **Names:** `snake_case` fields, plural resource names.',
      '',
      'Guides and tutorials: `documentation/api/` in the repository.',
    ].join('\n'),
    license: { name: 'MIT', identifier: 'MIT' },
    contact: { name: 'Project repository', url: 'https://github.com/Krivetka/npm-publication-monitor' },
  },
  // read endpoints need no credentials; the two write operations name their scheme themselves
  security: [],
  servers: [{ url: '/npm/api/v1', description: 'Behind nginx on the production host' }],
  tags: [
    { name: 'status', description: 'Health of the pipeline' },
    { name: 'events', description: 'The journal and per-event stage results' },
    { name: 'results', description: 'Stage 1 hits, enriched candidates and alerts' },
    { name: 'stats', description: 'Aggregates for charts and the evaluation' },
    { name: 'findings', description: 'Analyst verdicts (ground truth)' },
  ],
  paths: {
    '/status': {
      get: {
        tags: ['status'],
        summary: 'Pipeline status',
        description: 'Positions and lag of the collector and both stages, the size of the enrichment queue, the date of the watchlist snapshot and the start of the journal. The dashboard polls it and also receives it over the WebSocket.',
        operationId: 'getStatus',
        responses: {
          '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Status' } } } },
        },
      },
    },
    '/health': {
      get: {
        tags: ['status'],
        summary: 'Liveness for external monitors',
        description: 'Returns 200 when the collector polled within the last 5 minutes and stage 1 is less than 5 000 events behind; otherwise 503 with the reasons. Suitable for an uptime check that alerts on failure.',
        operationId: 'getHealth',
        responses: {
          '200': { description: 'Healthy', content: { 'application/json': { schema: { $ref: '#/components/schemas/Health' } } } },
          '503': { description: 'Degraded', content: { 'application/json': { schema: { $ref: '#/components/schemas/Health' } } } },
        },
      },
    },
    '/events': {
      get: {
        tags: ['events'],
        summary: 'Journal events, newest first',
        description: 'Cursor-paginated journal. Filters narrow the set before pagination. Use `after` with the `last_seq` from the WebSocket `hello` message to backfill a live feed.',
        operationId: 'listEvents',
        parameters: listParams([
          { name: 'package', in: 'query', description: 'Exact package name', schema: { type: 'string' } },
          { name: 'flagged', in: 'query', description: 'Only events with at least one stage-1 feature', schema: { type: 'boolean' } },
          { name: 'candidate', in: 'query', description: 'Only stage-1 candidates', schema: { type: 'boolean' } },
          { name: 'feature', in: 'query', description: 'Only events where this feature id fired (stage 1 or stage 2)', schema: { type: 'string' }, example: 'rev_jump' },
          { name: 'alert', in: 'query', description: 'Only alerts', schema: { type: 'boolean' } },
          { name: 'min_score', in: 'query', description: 'Minimum final score (enriched events only)', schema: { type: 'number' } },
        ]),
        responses: {
          '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/EventList' } } } },
          '400': errorResponse('Invalid parameter'),
        },
      },
    },
    '/alerts/query': {
      post: {
        tags: ['results'],
        summary: 'Alerts on the packages of one consumer',
        description: 'Takes a list of package names, for example the names of a lock file, and returns the alerts on these packages for the last days with the count per day. The request reads only; it is a POST because the list does not fit a URL. The list is not stored.',
        operationId: 'queryDependencyAlerts',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['packages'],
                properties: {
                  packages: { type: 'array', minItems: 1, maxItems: 10000, items: { type: 'string', maxLength: 214 } },
                  days: { type: 'integer', minimum: 1, maximum: 90, default: 14 },
                },
              },
              example: { packages: ['lodash', '@scope/name'], days: 14 },
            },
          },
        },
        responses: {
          '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/DependencyAlerts' } } } },
          '400': errorResponse('Invalid body'),
          '405': errorResponse('Any method but POST'),
          '413': errorResponse('Body larger than 512 KB'),
        },
      },
    },
    '/events/{seq}': {
      get: {
        tags: ['events'],
        summary: 'Event card',
        description: 'The event, both stage results in full (including the stage-2 evidence snapshot and per-source answers), the analyst finding and the other journal events of the same package.',
        operationId: 'getEvent',
        parameters: [{ name: 'seq', in: 'path', required: true, schema: { type: 'integer', format: 'int64' } }],
        responses: {
          '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/EventCard' } } } },
          '400': errorResponse('`seq` is not a positive integer'),
          '404': errorResponse('No such event'),
        },
      },
    },
    '/events/{seq}/finding': {
      put: {
        tags: ['findings'],
        summary: 'Record or change the analyst verdict',
        description: 'Stores one verdict per event. The call is idempotent: the same body gives the same stored verdict, a different body replaces it. Every change is kept in an audit table of the database.',
        operationId: 'putFinding',
        security: [{ analystToken: [] }],
        parameters: [{ name: 'seq', in: 'path', required: true, schema: { type: 'integer', format: 'int64' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['verdict'],
                properties: { verdict: finding.properties.verdict, note: finding.properties.note, reference: finding.properties.reference },
              },
              example: { verdict: 'confirmed', note: 'Matches the node-ipc write-up', reference: 'https://example.org/advisory' },
            },
          },
        },
        responses: {
          '200': { description: 'Stored', content: { 'application/json': { schema: { $ref: '#/components/schemas/Finding' } } } },
          '400': errorResponse('Invalid body'),
          '401': errorResponse('Missing or wrong token'),
          '404': errorResponse('No such event'),
          '413': errorResponse('Body larger than 16 KB'),
        },
      },
      delete: {
        tags: ['findings'],
        summary: 'Remove the verdict',
        description: 'Deletes the verdict of the event; the audit table keeps the removed value. Deleting a verdict that does not exist also answers 204.',
        operationId: 'deleteFinding',
        security: [{ analystToken: [] }],
        parameters: [{ name: 'seq', in: 'path', required: true, schema: { type: 'integer', format: 'int64' } }],
        responses: { '204': { description: 'Removed' }, '400': errorResponse('`seq` is not a positive integer'), '401': errorResponse('Missing or wrong token'), '404': errorResponse('No such event') },
      },
    },
    '/findings': {
      get: {
        tags: ['findings'],
        summary: 'All analyst verdicts',
        description: 'Every stored verdict, newest first; `verdict` narrows the list to one value.',
        operationId: 'listFindings',
        parameters: [{ name: 'verdict', in: 'query', schema: finding.properties.verdict }],
        responses: {
          '200': { description: 'OK', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Finding' } } } } },
          '400': errorResponse('Unknown verdict value'),
        },
      },
    },
    '/packages/{name}/events': {
      get: {
        tags: ['events'],
        summary: 'Journal events of one package',
        description: 'The newest events of the package with their stage results. This is the search of the dashboard.',
        operationId: 'listPackageEvents',
        parameters: [
          { name: 'name', in: 'path', required: true, description: 'Package name; scoped names URL-encoded (`%40scope%2Fname`)', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 200 } },
        ],
        responses: {
          '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/EventList' } } } },
          '400': errorResponse('Not a valid package name'),
          '404': errorResponse('No events for this package in the journal'),
        },
      },
    },
    '/packages/{name}/maintainers': {
      get: {
        tags: ['events'],
        summary: 'History of the maintainer set of a package',
        description: 'One row per observed change of the maintainer set (recorded by stage 2 at every enrichment).',
        operationId: 'listMaintainerHistory',
        parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'OK; an empty list when the package was never enriched', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/MaintainerSet' } } } } },
          '400': errorResponse('Not a valid package name'),
        },
      },
    },
    '/stats/totals': {
      get: {
        tags: ['stats'],
        summary: 'Funnel totals for the last N hours',
        description: 'How many events entered the journal, were processed by stage 1, fired a feature, became candidates, were enriched and raised an alert.',
        operationId: 'getTotals',
        parameters: [{ name: 'hours', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 720, default: 24 } }],
        responses: { '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Totals' } } } }, '400': errorResponse('`hours` is out of range') },
      },
    },
    '/stats/hourly': {
      get: {
        tags: ['stats'],
        summary: 'Hourly counts for charts',
        description: 'One row per hour, oldest first.',
        operationId: 'getHourly',
        parameters: [{ name: 'hours', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 720, default: 48 } }],
        responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/HourRow' } } } } }, '400': errorResponse('`hours` is out of range') },
      },
    },
    '/stats/pulse': {
      get: {
        tags: ['stats'],
        summary: 'Events per minute for the last hour',
        description: 'Sixty points for the pulse chart of the overview.',
        operationId: 'getPulse',
        responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/PulsePoint' } } } } } },
      },
    },
    '/stats/features': {
      get: {
        tags: ['stats'],
        summary: 'Feature hit counts',
        description: 'How often every feature of both stages fired in the period.',
        operationId: 'getFeatureCounts',
        parameters: [{ name: 'hours', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 720, default: 24 } }],
        responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/FeatureCount' } } } } }, '400': errorResponse('`hours` is out of range') },
      },
    },
    '/stats/sources': {
      get: {
        tags: ['stats'],
        summary: 'External-source request accounting',
        description: 'Requests sent, failed and skipped for quota, per external source. The basis of the cost comparison in the evaluation.',
        operationId: 'getSourceUsage',
        parameters: [{ name: 'hours', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 720, default: 24 } }],
        responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/SourceUsage' } } } } }, '400': errorResponse('`hours` is out of range') },
      },
    },
    '/features': {
      get: {
        tags: ['stats'],
        summary: 'Catalogue of features with labels, lanes and weights',
        description: 'Every feature the two stages can fire, with the text the dashboard shows for it and its current weight.',
        operationId: 'listFeatureCatalogue',
        responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/FeatureInfo' } } } } } },
      },
    },
  },
  components: {
    securitySchemes: {
      analystToken: { type: 'http', scheme: 'bearer', description: '`ANALYST_TOKEN` from the server environment' },
    },
    schemas: {
      Error: { type: 'object', description: 'Every error answer. The message names the rejected parameter; it is meant for a developer, not for an end user.', required: ['error'], properties: { error: { type: 'string', example: 'limit: must be >= 1' } } },
      Feature: feature,
      FeatureInfo: {
        type: 'object',
        required: ['id', 'stage', 'lane', 'title', 'short', 'hint', 'weight'],
        properties: {
          id: { type: 'string' }, stage: { type: 'integer', enum: [1, 2] }, lane: { type: 'string' },
          title: { type: 'string' }, short: { type: 'string' }, hint: { type: 'string' }, weight: { type: 'number' },
        },
      },
      Stage1Summary: stage1Summary,
      Stage2Summary: stage2Summary,
      Finding: finding,
      Event: event,
      EventList: eventList,
      DependencyAlerts: {
        type: 'object',
        required: ['packages', 'days', 'items'],
        properties: {
          packages: { type: 'integer', description: 'Distinct names in the request' },
          days: { type: 'array', items: { type: 'object', required: ['day', 'alerts'], properties: { day: { type: 'string', format: 'date' }, alerts: { type: 'integer' } } } },
          items: { type: 'array', items: { $ref: '#/components/schemas/Event' }, description: 'Alerts of the period, newest first, at most 500' },
        },
      },
      EventCard: {
        type: 'object',
        required: ['event', 'stage1', 'stage2', 'finding', 'package_events'],
        properties: {
          event: { $ref: '#/components/schemas/Event' },
          stage1: { oneOf: [{ $ref: '#/components/schemas/Stage1Summary' }, { type: 'null' }] },
          stage2: {
            oneOf: [
              {
                allOf: [
                  { $ref: '#/components/schemas/Stage2Summary' },
                  { type: 'object', properties: { evidence: { type: 'object', additionalProperties: true }, sources: { type: 'object', additionalProperties: true } } },
                ],
              },
              { type: 'null' },
            ],
          },
          finding: { oneOf: [{ $ref: '#/components/schemas/Finding' }, { type: 'null' }] },
          package_events: { type: 'array', items: { $ref: '#/components/schemas/Event' } },
        },
      },
      MaintainerSet: {
        type: 'object',
        required: ['package', 'seq', 'observed_at', 'maintainers'],
        properties: {
          package: { type: 'string' }, seq: { type: 'integer', format: 'int64' },
          observed_at: { type: 'string', format: 'date-time' },
          maintainers: { type: 'array', items: { type: 'string' } },
          added: { type: 'array', items: { type: 'string' } }, removed: { type: 'array', items: { type: 'string' } },
        },
      },
      Status: {
        type: 'object',
        required: ['collector', 'stage1', 'stage2', 'popular', 'journal', 'now'],
        properties: {
          now: { type: 'string', format: 'date-time' },
          collector: {
            type: ['object', 'null'],
            properties: { last_seq: { type: 'integer' }, head_seq: { type: ['integer', 'null'] }, lag: { type: ['integer', 'null'] }, polled_at: { type: 'string', format: 'date-time' }, advanced_at: { type: 'string', format: 'date-time' } },
          },
          stage1: { type: ['object', 'null'], properties: { last_seq: { type: 'integer' }, lag: { type: 'integer' }, updated_at: { type: 'string', format: 'date-time' } } },
          stage2: { type: 'object', properties: { queue: { type: 'integer' }, last_at: { type: ['string', 'null'], format: 'date-time' } } },
          popular: { type: 'object', properties: { snapshot: { type: ['string', 'null'], format: 'date' }, names: { type: 'integer' } } },
          journal: { type: 'object', properties: { first: { type: ['string', 'null'], format: 'date-time' }, estimate: { type: 'integer' } } },
        },
      },
      Health: {
        type: 'object',
        required: ['ok', 'checks'],
        properties: {
          ok: { type: 'boolean' },
          checks: { type: 'object', additionalProperties: { type: 'object', properties: { ok: { type: 'boolean' }, detail: { type: 'string' } } } },
        },
      },
      Totals: {
        type: 'object',
        required: ['hours', 'events', 'processed', 'flagged', 'candidates', 'enriched', 'alerts'],
        properties: {
          hours: { type: 'integer' }, events: { type: 'integer' }, processed: { type: 'integer' }, flagged: { type: 'integer' },
          candidates: { type: 'integer' }, enriched: { type: 'integer' }, alerts: { type: 'integer' },
        },
      },
      HourRow: {
        type: 'object',
        required: ['hour', 'processed', 'candidates', 'enriched', 'alerts'],
        properties: { hour: { type: 'string', format: 'date-time' }, processed: { type: 'integer' }, candidates: { type: 'integer' }, enriched: { type: 'integer' }, alerts: { type: 'integer' } },
      },
      PulsePoint: { type: 'object', required: ['minute', 'n'], properties: { minute: { type: 'string', format: 'date-time' }, n: { type: 'integer' } } },
      FeatureCount: { type: 'object', required: ['stage', 'id', 'count'], properties: { stage: { type: 'integer' }, id: { type: 'string' }, count: { type: 'integer' } } },
      SourceUsage: {
        type: 'object',
        required: ['source', 'requests', 'errors', 'skipped'],
        properties: { source: { type: 'string', enum: ['registry', 'ecosystems', 'depsdev', 'github', 'rdap'] }, requests: { type: 'integer' }, errors: { type: 'integer' }, skipped: { type: 'integer' } },
      },
    },
  },
} as const;

// Messages of the answers that cannot be captured without the analyst token or a huge body.
const FIXED_ERRORS: Record<string, string> = {
  'putFinding 400': 'verdict must be one of confirmed, false_positive, undecided',
  'putFinding 404': 'no such event',
  'putFinding 413': 'body too large',
  'deleteFinding 400': 'seq: expected a positive integer',
  'deleteFinding 404': 'no such event',
  'queryDependencyAlerts 413': 'body too large',
};

type Media = { schema?: unknown; example?: unknown };
type Operation = { operationId: string; responses: Record<string, { description: string; content?: Record<string, Media> }> };

function withExamples<T extends { paths: Record<string, Record<string, unknown>> }>(doc: T): T {
  const out = structuredClone(doc) as T;
  for (const item of Object.values(out.paths)) {
    for (const op of Object.values(item) as Operation[]) {
      const ok = EXAMPLES[op.operationId];
      for (const [code, res] of Object.entries(op.responses)) {
        const media = res.content?.['application/json'];
        if (!media) continue;
        if (ok && String(ok.status) === code) media.example = ok.response;
        else if (op.operationId === 'getHealth' && code === '503' && HEALTH_DEGRADED) media.example = HEALTH_DEGRADED.response;
        else {
          const captured = ERROR_EXAMPLES.find((e) => e.operation === op.operationId && String(e.status) === code);
          const fixed = FIXED_ERRORS[`${op.operationId} ${code}`];
          if (captured) media.example = captured.response;
          else if (fixed) media.example = { error: fixed };
        }
      }
    }
  }
  return out;
}

export const openapi = withExamples(document);
