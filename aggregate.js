/**
 * @param {Meteor.publish} sub
 * @param {Mongo.Collection} collection
 * @param {Object[]} pipeline
 * @param {Object[]} options
 * @constructor
 */
export const ReactiveAggregate = (sub, collection = null, pipeline = [], options = {}) => {
  import { Meteor } from 'meteor/meteor';
  import { Mongo } from 'meteor/mongo';

  // Define new Meteor Error type
  const TunguskaReactiveAggregateError = Meteor.makeErrorType('tunguska:reactive-aggregate', function(msg) {
    this.message = msg;
    this.path = '';
    this.sanitizedError = new Meteor.Error('Error', 'tunguska:reactive-aggregate');
  });

  // Check inbound parameter types
  if (!(sub && sub.ready && sub.stop)) {
    throw new TunguskaReactiveAggregateError('unexpected context - did you set "sub" to "this"?');
  }
  if (!(collection instanceof Mongo.Collection)) {
    throw new TunguskaReactiveAggregateError('"collection" must be a Mongo.Collection');
  }
  if (!(pipeline instanceof Array)) {
    throw new TunguskaReactiveAggregateError('"pipeline" must be an array');
  }
  if (!(options instanceof Object)) {
    throw new TunguskaReactiveAggregateError('"options" must be an object');
  }

  /**
   * Set up local options based on defaults and supplied options.
   *
   * @type {Object}
   * @property {boolean} [noAutomaticObserver=false]
   * @property {Object} aggregationOptions: {},
   * @property {Object} observeSelector: {},
   * @property {Object} observeOptions: {},
   * @property {Object[]} observers - cursor1, ... cursorn
   * @property {number} [debounceCount=0],
   * @property {number} [debounceDelay=0] - mS
   * @property {string} clientCollection - collection._name,
   * @property {string} [docsPropName] - Set with the name of the prop containing the docs, if not on ROOT of the
   * aggregation result.
   * @property {string} [clientExtrasCollection='ReactiveAggregate'] - collection._name,
   */
  const localOptions = {
    ...{
      noAutomaticObserver: false,
      aggregationOptions: {},
      observeSelector: {},
      observeOptions: {},
      observers: [], // cursor1, ... cursorn
      debounceCount: 0,
      debounceDelay: 0, // mS
      clientCollection: collection._name,
      docsPropName: undefined,
      clientExtrasCollection: 'ReactiveAggregate',
    },
    ...options
  };

  // Check options
  if (typeof localOptions.noAutomaticObserver !== 'boolean') {
    throw new TunguskaReactiveAggregateError('"options.noAutomaticObserver" must be true or false');
  }
  if (typeof localOptions.observeSelector !== 'object') {
    throw new TunguskaReactiveAggregateError('deprecated "options.observeSelector" must be an object');
  }
  if (typeof localOptions.observeOptions !== 'object') {
    throw new TunguskaReactiveAggregateError('deprecated "options.observeOptions" must be an object');
  }
  if (!(localOptions.observers instanceof Array)) {
    throw new TunguskaReactiveAggregateError('"options.observers" must be an array of cursors');
  } else {
    localOptions.observers.forEach((cursor, i) => {
      // The obvious "cursor instanceof Mongo.Cursor" doesn't seem to work, so...
      if (!(cursor._cursorDescription && cursor._cursorDescription.collectionName)) {
        throw new TunguskaReactiveAggregateError(`"options.observers[${i}]" must be a cursor`);
      }
    });
  }
  if (!(typeof localOptions.debounceCount === 'number')) {
    throw new TunguskaReactiveAggregateError('"options.debounceCount" must be a positive integer');
  } else {
    localOptions.debounceCount = parseInt(localOptions.debounceCount, 10);
    if (localOptions.debounceCount < 0) {
      throw new TunguskaReactiveAggregateError('"options.debounceCount" must be a positive integer');
    }
  }
  if (!(typeof localOptions.debounceDelay === 'number')) {
    throw new TunguskaReactiveAggregateError('"options.debounceDelay" must be a positive integer');
  } else {
    localOptions.debounceDelay = parseInt(localOptions.debounceDelay, 10);
    if (localOptions.debounceDelay < 0) {
      throw new TunguskaReactiveAggregateError('"options.debounceDelay" must be a positive integer');
    }
  }
  if (typeof localOptions.clientCollection !== 'string') {
    throw new TunguskaReactiveAggregateError('"options.clientCollection" must be a string');
  }


  // Warn about deprecated parameters if used
  if (Object.keys(localOptions.observeSelector).length != 0) console.log('tunguska:reactive-aggregate: observeSelector is deprecated');
  if (Object.keys(localOptions.observeOptions).length != 0) console.log('tunguska:reactive-aggregate: observeOptions is deprecated');

  // observeChanges() will immediately fire an "added" event for each document in the cursor
  // these are skipped using the initializing flag
  let initializing = true;

  sub._ids = {};
  sub._iteration = 1;

  const update = async () => {
    if (initializing) return;
    // add and update documents on the client
    try {
      const aggregationResult =  await collection.rawCollection().aggregate(pipeline, localOptions.aggregationOptions)
        .toArray();
      console.log(aggregationResult);
      const docs = localOptions.docsPropName
        ? aggregationResult[0][localOptions.docsPropName]
        : aggregationResult;
      const extras = {};
      let initializingExtras = true;

      if (localOptions.docsPropName) {
        Object.keys(aggregationResult[0])
          .forEach((extraPropName) => {
            if (extraPropName !== localOptions.docsPropName) {
              extras[extraPropName] = aggregationResult[0][extraPropName];
            }
          });

        if (initializingExtras) {
          sub.added(localOptions.clientExtrasCollection, sub._subscriptionId, extras);
        } else {
          sub.changed(localOptions.clientExtrasCollection, sub._subscriptionId, extras);
        }
        initializingExtras = false;
      }

      docs.forEach(doc => {
        if (!sub._ids[doc._id]) {
          sub.added(localOptions.clientCollection, doc._id, doc);
        } else {
          sub.changed(localOptions.clientCollection, doc._id, doc);
        }
        sub._ids[doc._id] = sub._iteration;
      });

      // remove documents not in the result anymore
      Object.keys(sub._ids).forEach(id => {
        if (sub._ids[id] !== sub._iteration) {
          delete sub._ids[id];
          sub.removed(localOptions.clientCollection, id);
        }
      });
      sub._iteration++;
    } catch (err) {
      throw new TunguskaReactiveAggregateError (err.message);
    }
  }

  let currentDebounceCount = 0;
  let timer;

  const debounce = () => {
    if (initializing) return;
    if (!timer && localOptions.debounceCount > 0) timer = Meteor.setTimeout(update, localOptions.debounceDelay);
    if (++currentDebounceCount > localOptions.debounceCount) {
      currentDebounceCount = 0;
      Meteor.clearTimeout(timer);
      update();
    }
  }

  if (!localOptions.noAutomaticObserver) {
    const cursor = collection.find(localOptions.observeSelector, localOptions.observeOptions);
    localOptions.observers.push(cursor);
  }

  const handles = [];
  // track any changes on the observed cursors
  localOptions.observers.forEach(cursor => {
    handles.push(cursor.observeChanges({
      added: debounce,
      changed: debounce,
      removed: debounce,
      error(err) {
        throw new TunguskaReactiveAggregateError (err.message);
      }
    }));
  });
  // End of the setup phase. We don't need to do any of that again!

  // Clear the initializing flag. From here, we're on autopilot
  initializing = false;
  // send an initial result set to the client
  update();
  // mark the subscription as ready
  sub.ready();

  // stop observing the cursors when the client unsubscribes
  sub.onStop(function () {
    handles.forEach(handle => {
      handle.stop();
    });
  });
};
