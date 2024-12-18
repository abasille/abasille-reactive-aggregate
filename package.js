Package.describe({
  name: 'abasille:reactive-aggregate',
  version: '1.2.0',
  summary: 'Publish aggregations reactively with $facet support',
  git: 'https://github.com/abasille/abasille-reactive-aggregate',
  documentation: 'README.md'
});

Package.onUse(function(api) {
  api.versionsFrom('1.5');
  api.use('mongo');
  api.use('ecmascript');
  api.mainModule('aggregate.js', 'server');
});
