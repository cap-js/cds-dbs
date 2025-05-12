'use strict';

// Each db has some changes that it can and cannot represent, or that cause problems only on that specific db
// In this file, we define rules for each db-dialect to detect and act on these cases.

const { forEach, forEachValue, forEachKey } = require('../../utils/objectUtils');
const { isPersistedAsTable, applyTransformations } = require('../../model/csnUtils');

function isKey( element ) {
  return element.key;
}

function getFilter(options) {
  const filters = {
    sqlite: getFilterObject(
      options,
      'sqlite',
      function forEachExtension(extend, name, elementOrConstraint, { error, warning }) {
        if (isKey(elementOrConstraint)) { // Key must not be extended
          error('type-unsupported-key-sqlite', [ 'definitions', extend, 'elements', name ], { id: name, name: 'sqlite', '#': 'std' } );
          return false;
        }
        else if (elementOrConstraint.parentTable) { // constraints have a .parentTable
          warning('def-unsupported-constraint-add', [ 'definitions', elementOrConstraint.parentTable, 'elements', elementOrConstraint.paths ? name : name.slice(elementOrConstraint.parentTable.length + 1) ], { id: elementOrConstraint.identifier || name, name: 'sqlite' },
                  'Ignoring add of constraint $(ID), as this is not supported for dialect $(NAME); you need to manually resolve this via shadow tables and data copy');
          return false;
        }

        return true;
      },
      function forEachMigration(migrate, name, migration, change, error) {
        const newIsKey = isKey(migration.new);
        const oldIsKey = isKey(migration.old);
        if ((newIsKey || oldIsKey) && oldIsKey !== newIsKey) // Turned into key or key was removed
          error('type-unsupported-key-sqlite', [ 'definitions', migrate, 'elements', name ], { id: name, name: 'sqlite', '#': 'changed' } );
        else
          delete change[name];
      },
      function forEachConstraintRemoval(constraintRemovals, name, constraint, warning) {
        warning('def-unsupported-constraint-drop', [ 'definitions', constraint.parentTable, 'elements', constraint.paths ? name : name.slice(constraint.parentTable.length + 1) ], { id: constraint.identifier || name, name: 'sqlite' },
                'Ignoring drop of constraint $(ID), as this is not supported for dialect $(NAME); you need to manually resolve this via shadow tables and data copy');
        delete constraintRemovals[name];
      },
      function primaryKey() {
        return false;
      }
    ),
    postgres: getFilterObject(options, 'postgres'),
    h2: getFilterObject(options, 'h2'),
    hana: getFilterObject(options, 'hana'),
  };

  return filters[options.sqlDialect];
}

module.exports = {
  csn: filterCsn,
  getFilter,
};

function getFilterObject( options, dialect, extensionCallback, migrationCallback, removeConstraintsCallback, primaryKeyCallback ) {
  const context = { hasLossyChanges: false };
  const raiseErrorOrMarkAsLossy = getSafeguardManager(context, options);
  const messageVariant = options.script ? 'script' : 'std';
  return {
    // will be called with a simple Array.filter, as we need to filter constraint `ADD` for SQLite
    extension: ({
      elements, constraint, constraintName, extend,
    }, { error, message, warning }) => {
      let returnValue = true;
      forEach(elements, (name, element) => {
        if (dialect !== 'sqlite' && isKey(element))
          message('migration-unsupported-key-change', [ 'definitions', extend, 'elements', name ], { id: name, '#': 'std' } );
        else if (extensionCallback && !extensionCallback(extend, name, element, { error, warning }))
          returnValue = false;
      });

      if (constraint && extensionCallback && !extensionCallback(extend, constraintName, constraint, { error, warning }))
        returnValue = false;

      return returnValue;
    },
    // will be called with a Array.forEach
    migration: (migrations, { error, warning, message }) => {
      forEach(migrations.remove, (name, migration) => {
        raiseErrorOrMarkAsLossy(name, migration, 'migration-unsupported-element-drop', id => message(id, [ 'definitions', migrations.migrate, 'elements', name ], { '#': messageVariant }));
      });

      forEach(migrations.change, (name, migration) => {
        const loc = [ 'definitions', migrations.migrate, 'elements', name ];
        if (migration.new.type === migration.old.type && migration.new.length < migration.old.length) {
          raiseErrorOrMarkAsLossy(name, migration, 'migration-unsupported-length-change', id => message(id, loc, { '#': messageVariant, id: name }));
        }
        else if (migration.new.type === migration.old.type && migration.new.scale < migration.old.scale || migration.new.precision - migration.old.precision < migration.new.scale - migration.old.scale) {
          raiseErrorOrMarkAsLossy(name, migration, 'migration-unsupported-scale-change', id => message(id, loc, { '#': messageVariant, id: name }));
        }
        else if (migration.new.type === migration.old.type && migration.new.precision < migration.old.precision) {
          raiseErrorOrMarkAsLossy(name, migration, 'migration-unsupported-precision-change', id => message(id, loc, { '#': messageVariant, id: name }));
        }
        else if (migration.new.type !== migration.old.type && typeChangeIsNotCompatible(dialect, migration.old.type, migration.new.type)) {
          raiseErrorOrMarkAsLossy(name, migration, 'migration-unsupported-change', id => message(id, loc, {
            '#': messageVariant, id: name, name: migration.old.type, type: migration.new.type,
          }));
        }
        else if (dialect !== 'sqlite' && isKey(migration.new) && !isKey(migration.old)) { // key added/changed - pg, hana and sqlite do not support it, h2 probably also - issues when data is in the table already
          raiseErrorOrMarkAsLossy(name, migration, 'migration-unsupported-key-change', id => message( id, [ 'definitions', migrations.migrate, 'elements', name ], { id: name, '#': 'changed' } ));
        }
        else if (migrationCallback) {
          migrationCallback(migrations.migrate, name, migration, migrations.change, error);
        }

        if (options.script && migration.lossy && migrationCallback)
          migrationCallback(migrations.migrate, name, migration, migrations.change, error);

        // TODO: precision/scale growth
      });

      if (removeConstraintsCallback) {
        const constraintTypes = [ 'unique', 'referential' ];
        constraintTypes.forEach((constraintType) => {
          forEach(migrations.removeConstraints?.[constraintType], (name, constraint) => {
            removeConstraintsCallback(migrations.removeConstraints[constraintType], name, constraint, warning);
          });
        });
      }
    },
    deletion: ([ artifactName, artifact ], { message }) => {
      if (isPersistedAsTable(artifact))
        raiseErrorOrMarkAsLossy(artifactName, artifact, 'migration-unsupported-table-drop', id => message(id, [ 'definitions', artifactName ], { '#': messageVariant }));
    },
    changedPrimaryKeys: (changedPrimaryKeyArtifactName) => {
      if (primaryKeyCallback)
        return primaryKeyCallback(changedPrimaryKeyArtifactName);

      return true;
    },
    hasLossyChanges: () => context.hasLossyChanges,
  };
}

const defaultAllowedTypeChanges = {
  // Integer types
  'cds.hana.tinyint': [ 'cds.UInt8', 'cds.Int16', 'cds.Int32', 'cds.Integer', 'cds.Int64', 'cds.Integer64' ],
  'cds.UInt8': [ 'cds.hana.tinyint', 'cds.Int16', 'cds.Int32', 'cds.Integer', 'cds.Int64', 'cds.Integer64' ],
  'cds.Int16': [ 'cds.hana.smallint', 'cds.Int32', 'cds.Integer', 'cds.Int64', 'cds.Integer64' ],
  'cds.hana.smallint': [ 'cds.Int16', 'cds.Int32', 'cds.Integer', 'cds.Int64', 'cds.Integer64' ],
  'cds.Int32': [ 'cds.Integer', 'cds.Int64', 'cds.Integer64' ],
  'cds.Integer': [ 'cds.Int32', 'cds.Int64', 'cds.Integer64' ],
  'cds.Integer64': [ 'cds.Int64' ],
  'cds.Int64': [ 'cds.Integer64' ],
};

const allowedTypeChanges = {
  sqlite: defaultAllowedTypeChanges,
  postgres: defaultAllowedTypeChanges,
  h2: defaultAllowedTypeChanges,
};

function typeChangeIsNotCompatible( dialect, before, after ) {
  if (allowedTypeChanges[dialect]) {
    const map = allowedTypeChanges[dialect];
    return map[before] ? !map[before].includes(after) : true;
  }
  return true;
}

/**
 * Filter non-diff-relevant properties from a db-expanded CSN.
 * Currently we filter:
 * - annotations
 *
 * @param {CSN.Model} csn CSN to filter
 * @returns {CSN.Model} Filtered input model
 */
function filterCsn( csn ) {
  const annosToKeep = {
    // + @cds.persistence.*
    '@assert.integrity': true,
    '@sql.append': true,
    '@sql.prepend': true,
  };

  applyTransformations(csn, {
    elements: (parent, prop, elements) => {
      forEachValue(elements, (element) => {
        forEachKey(element, (key) => {
          if ((key.startsWith('@') && !key.startsWith('@cds.persistence.') && !annosToKeep[key]) || key === 'keys')
            delete element[key];
        });
      });
    },
  }, [ (artifact) => {
    forEachKey(artifact, (key) => {
      if (key.startsWith('@') && !key.startsWith('@cds.persistence.') && !annosToKeep[key])
        delete artifact[key];
    });
  } ]);

  return csn;
}

function getSafeguardManager( context, options ) {
  return function raiseErrorOrMarkAsLossy(name, migration, id, raiseMessage) {
    raiseMessage(id);

    if (options.script) {
      migration.details = getDetails(id, name);
      migration.lossy = id !== 'migration-unsupported-key-change';
      context.hasLossyChanges = true;
    }
  };
}

const details = {
  'migration-unsupported-element-drop': 'drop of element',
  'migration-unsupported-length-change': 'length reduction of element',
  'migration-unsupported-scale-change': 'scale reduction of element',
  'migration-unsupported-precision-change': 'precision reduction of element',
  'migration-unsupported-change': 'incompatible type change of element',
  'migration-unsupported-key-change': 'key property change of element',
  'migration-unsupported-table-drop': 'drop of entity',
};

function getDetails(id, name) {
  if (details[id])
    return `${ details[id] } "${ name }" - check warnings for details`;

  return null;
}
