Package.describe({
  name: 'tunguska:reactive-aggregate',
  version: '1.2.0',
  summary: 'Publish aggregations reactively',
  git: 'https://github.com/abasille/abasille-reactive-aggregate',
  documentation: 'README.md'
});

Package.onUse(function(api) {
  api.versionsFrom('1.5');
  api.use('mongo');
  api.use('ecmascript');
  api.mainModule('aggregate.js', 'server');
});
