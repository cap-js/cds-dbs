const cds = require('../../index')

module.exports = {
  _version: cds.version,

  title: 'JSON schema for CDS configuration',
  $schema: 'https://json-schema.org/draft-07/schema',
  description: 'This is a JSON schema representation for CDS project configuration',
  type: 'object',
  additionalProperties: true,

  allOf: [
    // allow cds configuration in root of .cds-rc.js...
    {
      $ref: '#/$defs/cdsRoot'
    },

    // ...and underneath cds section
    {
      properties: {
        cds: {
          description: 'CDS configuration root',
          $ref: '#/$defs/cdsRoot'
        }
      }
    }
  ],

  $defs: {
    cdsRoot: {
      allowAdditionalProperties: true,
      patternProperties: {
        '\\[.+\\]': {
          default: {},
          description: 'Generic cds profile',
          $ref: '#/$defs/cdsRoot'
        }
      },
      properties: {
        '[development]': {
          default: {},
          description: 'Development profile',
          $ref: '#/$defs/cdsRoot'
        },
        '[production]': {
          default: {},
          description: 'Production profile',
          $ref: '#/$defs/cdsRoot'
        },
        '[hybrid]': {
          default: {},
          description: 'Hybrid profile',
          $ref: '#/$defs/cdsRoot'
        },
        profile: {
          default: {},
          description: 'A single static profile',
          anyOf: [
            {
              enum: [
                'mtx-sidecar',
                'with-mtx-sidecar',
                'java',
                'subscription-manager'
              ]
            },
            {
              type: 'string'
            }
          ]
        },
        profiles: {
          default: [],
          description: 'An array of profiles',
          type: 'array',
          uniqueItems: true,
          items: {
            $ref: '#/$defs/cdsRoot/properties/profile'
          }
        },
        folders: {
          type: 'object',
          default: {},
          description: 'Only set folders if you don\'t want to use the defaults \'app/\', \'db/\', \'srv/\'.',
          additionalProperties: true,
          properties: {
            app: {
              type: 'string',
              format: 'uri-reference',
              description: 'Add a custom path for the app property, which becomes \'cds.roots\'.'
            },
            db: {
              type: 'string',
              format: 'uri-reference',
              description: 'Add a custom path for the db property, which becomes \'cds.roots\'.'
            },
            srv: {
              type: 'string',
              format: 'uri-reference',
              description: 'Add a custom path for the srv property, which becomes \'cds.roots\'.'
            }
          },
          patternProperties: {
            '\\[.+\\]': {
              default: {},
              description: 'Generic folders profile',
              $ref: '#/$defs/cdsRoot/properties/folders'
            },
            '.+': {
              description: 'A static name identifying this folder.'
            }
          }
        },
        i18n: {
          type: 'object',
          description: 'Customize CDS translation settings.',
          additionalProperties: true,
          patternProperties: {
            '\\[.+\\]': {
              default: {},
              description: 'Generic i18n profile',
              $ref: '#/$defs/cdsRoot/properties/i18n'
            }
          },
          properties: {
            default_language: {
              type: 'string'
            },
            folders: {
              description: 'Define the list of folders containing language files. Defaults are \'_i18n/\', and \'i18n/\'. First valid entry wins.',
              default: [],
              $ref: '#/$defs/foldersStringArray'
            }
          }
        },
        requires: {
          type: 'object',
          default: {},
          description: 'Define all required services.',
          additionalProperties: true,
          properties: {
            auth: {
              oneOf: [
                {
                  type: 'string',
                  description: 'Use standard auth-specific settings via shortcut.',
                  anyOf: [
                    {
                      $ref: '#/$defs/authType'
                    },
                    {
                      minLength: 1
                    }
                  ]
                },
                {
                  type: 'object',
                  description: 'Use custom authentication settings.',
                  default: {},
                  additionalProperties: true,
                  // support for [profileName] syntax
                  patternProperties: {
                    '\\[.+\\]': {
                      description: 'aloha',
                      $ref: '#/$defs/cdsRoot/properties/requires/properties/auth'
                    }
                  },
                  properties: {
                    kind: {
                      type: 'string',
                      description: 'Define the kind of strategy.',
                      anyOf: [
                        {
                          $ref: '#/$defs/authType'
                        },
                        {
                          minLength: 1
                        }
                      ]
                    },
                    users: {
                      $ref: '#/$defs/mockUsers'
                    },
                    credentials: {
                      type: 'object',
                      description: 'You can explicitly configure credentials, but this is overruled by VCAP_SERVICES if a matching entry is found therein.',
                      additionalProperties: true,
                      properties: {
                        database: {
                          type: 'string',
                          format: 'uri-reference'
                        }
                      }
                    }
                  }
                }
              ]
            },
            db: {
              oneOf: [
                {
                  type: 'string',
                  description: 'Settings for the primary database (shortcut).',
                  anyOf: [
                    {
                      $ref: '#/$defs/databaseKind'
                    },
                    {
                      minLength: 1
                    }
                  ]
                },
                {
                  type: 'object',
                  description: 'Settings for the primary database.',
                  default: {},
                  additionalProperties: true,
                  patternProperties: {
                    '\\[.+\\]': {
                      $ref: '#/$defs/cdsRoot/properties/requires/properties/db'
                    }
                  },
                  properties: {
                    kind: {
                      type: 'string',
                      description: 'Service kind',
                      anyOf: [
                        {
                          $ref: '#/$defs/databaseKind'
                        },
                        {
                          minLength: 1
                        }
                      ]
                    },
                    model: {
                      description: 'Define the assigned model. Interpreted like Node.js \'requires\' logic.',
                      $ref: '#/$defs/foldersStringArray'
                    },
                    credentials: {
                      type: 'object',
                      description: 'You can explicitly configure credentials, but this is overruled by VCAP_SERVICES if a matching entry is found therein.',
                      additionalProperties: true,
                      properties: {
                        database: {
                          type: 'string',
                          format: 'uri-reference',
                          deprecated: true,
                          description: 'Deprecated: Use \'url\' instead.'
                        }
                      }
                    },
                    vcap: {
                      type: 'object',
                      description: 'Optional: Used to select an entry in VCAP_SERVICES.',
                      additionalProperties: true,
                      properties: {
                        name: {
                          type: 'string',
                          minLength: 1
                        }
                      }
                    }
                  }
                }
              ]
            },
            multitenancy: {
              oneOf: [
                {
                  type: 'boolean',
                  description: 'Shortcut to enable multitenancy.'
                },
                {
                  type: 'object',
                  description: 'Multitenancy configuration options.',
                  additionalProperties: true,
                  patternProperties: {
                    '\\[.+\\]': {
                      $ref: '#/$defs/cdsRoot/properties/requires/properties/multitenancy'
                    }
                  },
                  properties: {
                    jobs: {
                      type: 'object',
                      description: 'Configuration options for the built-in async job executor.',
                      properties: {
                        workerSize: {
                          type: 'number',
                          description: 'Number of workers running in parallel per database.'
                        },
                        clusterSize: {
                          type: 'number',
                          description: 'Number of databases executing parallel tasks.'
                        }
                      }
                    }
                  }
                }
              ]
            },
            extensibility: {
              oneOf: [
                {
                  type: 'boolean',
                  description: 'Shortcut to enable extensibility.'
                },
                {
                  type: 'object',
                  description: 'Extensibility configuration options.',
                  additionalProperties: true,
                  patternProperties: {
                    '\\[.+\\]': {
                      $ref: '#/$defs/cdsRoot/properties/requires/properties/extensibility'
                    }
                  },
                  properties: {
                    tenantCheckInterval: {
                      type: 'number',
                      description: 'Time interval in ms to check for new extensions and refreshed models.'
                    },
                    evictionInterval: {
                      type: 'number',
                      description: 'Time interval in ms after which to evict models for inactive tenants.'
                    }
                  }
                }
              ]
            },
            toggles: {
              type: 'boolean',
              description: 'Shortcut to enable feature toggles.'
            },
            messaging: {
              oneOf: [
                {
                  type: 'boolean',
                  description: 'Shortcut to enable messaging.'
                },
                {
                  type: 'string',
                  description: 'Settings for the primary messaging service (shortcut).',
                  anyOf: [
                    {
                      $ref: '#/$defs/messagingKind'
                    },
                    {
                      minLength: 1
                    }
                  ]
                },
                {
                  type: 'object',
                  description: 'Settings for the primary messaging service.',
                  default: {},
                  additionalProperties: true,
                  patternProperties: {
                    '\\[.+\\]': {
                      $ref: '#/$defs/cdsRoot/properties/requires/properties/messaging'
                    }
                  },
                  properties: {
                    kind: {
                      type: 'string',
                      description: 'Service kind',
                      anyOf: [
                        {
                          $ref: '#/$defs/messagingKind'
                        },
                        {
                          minLength: 1
                        }
                      ]
                    },
                    credentials: {
                      type: 'object',
                      description: 'You can explicitly configure credentials, but this is overruled by VCAP_SERVICES if a matching entry is found therein.',
                      additionalProperties: true,
                      properties: {
                        database: {
                          type: 'string',
                          format: 'uri-reference'
                        }
                      }
                    },
                    vcap: {
                      type: 'object',
                      description: 'Optional: Used to select an entry in VCAP_SERVICES.',
                      additionalProperties: true,
                      properties: {
                        name: {
                          type: 'string',
                          minLength: 1
                        }
                      }
                    }
                  }
                }
              ]
            },
            'cds.xt.ModelProviderService': {
              description: 'Configure if/how the ModelProviderService serves model variants that may include tenant-specific extensions and/or feature-toggled aspects.',
              oneOf: [
                {
                  type: 'boolean'
                },
                {
                  $ref: '#/$defs/servicePresetSidecar'
                },
                {
                  type: 'object',
                  description: 'ModelProviderService configuration options.',
                  additionalProperties: true,
                  patternProperties: {
                    '\\[.+\\]': {
                      $ref: '#/$defs/cdsRoot/properties/requires/properties/cds.xt.ModelProviderService'
                    }
                  },
                  properties: {
                    root: {
                      type: 'string',
                      description: 'A directory name, absolute or relative to the package.json\'s location, specifying the location to search for models and resources to be served by the model provider services. Default is undefined, for embedded usage of model provider. In case of a sidecar, it refers to the main app\'s model; usually \'../..\' during development, and \'_main\' in production.',
                      format: 'uri-reference'
                    }
                  }
                }
              ]
            },
            'cds.xt.ExtensibilityService': {
              description: 'Configure if/how the ExtensibilityService allows to add and activate tenant-specific extensions at runtime.',
              oneOf: [
                {
                  type: 'boolean'
                },
                {
                  $ref: '#/$defs/extensibilitySettings'
                }
              ]
            },
            'cds.xt.DeploymentService': {
              description: 'Configure if/how the DeploymentService handles subscribe, unsubscribe, and upgrade events for single tenants and single apps/micro-services.',
              oneOf: [
                {
                  type: 'boolean'
                },
                {
                  $ref: '#/$defs/servicePresetSidecar'
                },
                {
                  type: 'object',
                  description: 'DeploymentService configuration options.',
                  additionalProperties: true,
                  patternProperties: {
                    '\\[.+\\]': {
                      $ref: '#/$defs/cdsRoot/properties/requires/properties/cds.xt.DeploymentService'
                    }
                  },
                  properties: {
                    hdi: {
                      type: 'object',
                      description: 'Bundles HDI-specific settings.',
                      properties: {
                        create: {
                          type: 'object',
                          description: 'HDI container provisioning parameters.',
                          properties: {
                            database_id: {
                              type: 'string',
                              description: 'HANA Cloud instance ID.'
                            },
                            additionalProperties: true
                          }
                        },
                        bind: {
                          type: 'object',
                          description: 'HDI container binding parameters.'
                        },
                        deploy: {
                          type: 'object',
                          description: 'HDI deployment parameters as defined on https://www.npmjs.com/package/@sap/hdi-deploy#supported-features'
                        }
                      }
                    },
                    lazyT0: {
                      type: 'boolean',
                      description: 'Onboard bookkeeping t0 container at the first subscription.'
                    }
                  }
                }
              ]
            },
            'cds.xt.SaasProvisioningService': {
              description: 'Out-of-the-box integration with SAP BTP SaaS Provisioning service.',
              oneOf: [
                {
                  type: 'boolean'
                },
                {
                  type: 'object',
                  description: 'SaasProvisioningService configuration options.',
                  additionalProperties: true,
                  patternProperties: {
                    '\\[.+\\]': {
                      $ref: '#/$defs/cdsRoot/properties/requires/properties/cds.xt.SaasProvisioningService'
                    }
                  },
                  properties: {
                    jobs: {
                      type: 'object',
                      description: 'Configuration options for the built-in async job executor.',
                      properties: {
                        workerSize: {
                          type: 'number',
                          description: 'Number of workers running in parallel per database.'
                        },
                        clusterSize: {
                          type: 'number',
                          description: 'Number of databases executing parallel tasks.'
                        }
                      },
                      additionalProperties: true
                    }
                  }
                }
              ]
            },
            'cds.xt.SmsProvisioningService': {
              description: 'Out-of-the-box integration with SAP BTP Subscription Management service.',
              oneOf: [
                {
                  type: 'boolean'
                },
                {
                  type: 'object',
                  description: 'SmsProvisioningService configuration options.',
                  additionalProperties: true,
                  patternProperties: {
                    '\\[.+\\]': {
                      $ref: '#/$defs/cdsRoot/properties/requires/properties/cds.xt.SmsProvisioningService'
                    }
                  }
                }
              ]
            }
          },
          patternProperties: {
            '\\[.+\\]': {
              default: {},
              description: 'Generic requires profile',
              $ref: '#/$defs/cdsRoot/properties/requires'
            },
            '.+': {
              oneOf: [
                {
                  type: 'boolean',
                  description: 'Add this type with default settings during runtime.'
                },
                {
                  type: 'string',
                  description: 'A shortcut referencing a predefined configuration.',
                  anyOf: [
                    {
                      $ref: '#/$defs/authType'
                    },
                    {
                      $ref: '#/$defs/databaseKind'
                    },
                    {
                      $ref: '#/$defs/serviceType'
                    },
                    {
                      minLength: 1
                    }
                  ]
                },
                {
                  type: 'object',
                  default: {},
                  additionalProperties: true,
                  properties: {
                    kind: {
                      type: 'string',
                      description: 'Service kind',
                      anyOf: [
                        {
                          $ref: '#/$defs/authType'
                        },
                        {
                          $ref: '#/$defs/databaseKind'
                        },
                        {
                          $ref: '#/$defs/serviceType'
                        },
                        {
                          minLength: 1
                        }
                      ]
                    },
                    model: {
                      description: 'A relative path to the model definition.',
                      $ref: '#/$defs/foldersStringArray'
                    }
                  }
                }
              ]
            }
          }
        },
        protocols: {
          type: 'object',
          default: {},
          description: 'List protocols to enable in addition to the default protocol adaptors.',
          additionalProperties: true,
          patternProperties: {
            '\\[.+\\]': {
              default: {},
              description: 'Generic protocols profile',
              $ref: '#/$defs/cdsRoot/properties/protocols/patternProperties/.+/oneOf/2'
            },
            '.+': {
              oneOf: [
                {
                  type: 'boolean',
                  description: 'Enables a built-in protocol adapter with defaults'
                },
                {
                  type: 'string',
                  description: 'The endpoint to serve this protocol at.'
                },
                {
                  type: 'object',
                  default: {},
                  additionalProperties: true,
                  properties: {
                    path: {
                      type: 'string',
                      description: 'The endpoint to serve this protocol at.'
                    },
                    impl: {
                      type: 'string',
                      description: 'The module pathname of the protocol adapter implementation.'
                    }
                  }
                }
              ]
            }
          }
        }
      }
    },

    serviceType: {
      enum: [
        'app-service',
        'odata',
        'odata-v2',
        'odata-v4',
        'rest'
      ],
      enumDescriptions: [
        'Standard app service',
        'OData service',
        'OData service version 2',
        'OData service version 4',
        'REST service'
      ]
    },

    authType: {
      default: 'mocked',
      enum: [
        'mocked',
        'basic',
        'jwt',
        'xsuaa',
        'dummy'
      ],
      enumDescriptions: [
        'Mocked authentication',
        'Basic authentication',
        'JWT authentication',
        'Authentication using XSUAA',
        'Dummy authentication'
      ]
    },

    mockUsers: {
      type: 'object',
      description: 'List of users for local usage.',
      properties: {
        '*': {
          default: true,
          enum: [
            true,
            false
          ],
          enumDescriptions: [
            'Allow other users than the ones specified.',
            'Block other users than the ones specified.'
          ]
        }
      },
      patternProperties: {
        '.+': {
          type: 'object',
          additionalProperties: true,
          properties: {
            roles: {
              type: 'array',
              description: 'Roles of the user.',
              uniqueItems: true,
              items: {
                type: 'string'
              }
            },
            features: {
              type: 'array',
              description: 'Feature toggle values of the user.',
              uniqueItems: true,
              items: {
                type: 'string'
              }
            },
            tenant: {
              type: 'string',
              description: 'SaaS tenant of the user.'
            },
            attr: {
              type: 'object',
              description: 'Additional user attributes.',
              patternProperties: {
                '.+': {
                  type: 'string',
                  description: 'Attribute value'
                }
              }
            },
            password: {
              type: 'string',
              description: 'User password'
            }
          }
        }
      }
    },

    databaseKind: {
      default: 'sqlite',
      enum: [
        'hana',
        'sql',
        'sqlite'
      ],
      enumDescriptions: [
        'SAP HANA',
        'In-memory SQLite (development), SAP HANA (production)',
        'File-based SQLite'
      ]
    },

    messagingKind: {
      default: 'local-messaging',
      enum: [
        'file-based-messaging',
        'enterprise-messaging',
        'enterprise-messaging-shared',
        'event-broker',
        'redis-messaging',
        'local-messaging',
        'composite-messaging'
      ],
      enumDescriptions: [
        'File-based messaging',
        'SAP Event Mesh',
        'SAP Event Mesh (shared)',
        'SAP Cloud Application Event Hub',
        'Redis messaging',
        'Local messaging',
        'Composite messaging'
      ]
    },

    foldersStringArray: {
      oneOf: [
        {
          type: 'string',
          format: 'uri-reference'
        },
        {
          type: 'array',
          uniqueItems: true,
          items: {
            type: 'string',
            format: 'uri-reference'
          }
        }
      ]
    },

    serviceActivation: {
      type: 'boolean'
    },

    servicePresetSidecar: {
      type: 'string',
      description: '\'in-sidecar\' preset provides defaults for usage in sidecars.\n\'from-sidecar\' preset is a shortcut for \'{ kind: rest }\'.',
      enum: [
        'in-sidecar',
        'from-sidecar'
      ]
    },

    extensibilitySettings: {
      type: 'object',
      description: 'Extensibility settings',
      additionalProperties: false,
      properties: {
        'check-existing-extensions': {
          type: 'boolean',
          description: `Specifies whether the extension linter includes existing extensions. Default will be 'true' with the next major release.`,
          default: false
        },
        'activate': {
          type: 'object',
          description: 'Activation settings',
          additionalProperties: false,
          properties: {
            'skip-db': {
              type: 'boolean',
              description: 'Skip database activation.'
            }
          }
        },
        'element-prefix': {
          type: 'array',
          description: 'Field names must start with one of these strings.',
          uniqueItems: true,
          items: {
            type: 'string'
          }
        },
        'namespace-blocklist': {
          type: 'array',
          description: 'Namespaces must not start with these strings.',
          uniqueItems: true,
          items: {
            type: 'string'
          }
        },
        'extension-allowlist': {
          type: 'array',
          description: 'Restrictions for model entities, types, etc.',
          uniqueItems: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              for: {
                type: 'array',
                description: 'Restriction applies to these services.',
                uniqueItems: true,
                items: {
                  type: 'string'
                }
              },
              kind: {
                type: 'string',
                description: 'Type of definition',
                default: 'entity',
                enum: [
                  'action',
                  'annotation',
                  'context',
                  'entity',
                  'function',
                  'service',
                  'type'
                ]
              },
              'new-fields': {
                type: 'integer',
                description: 'Number of fields to be added at most.',
                minimum: 1
              },
              'fields': {
                type: 'array',
                description: 'Fields that are allowed to be extended.',
                uniqueItems: true,
                items: {
                  type: 'string'
                }
              },
              'new-entities': {
                type: 'integer',
                description: 'Number of entities to be added at most.',
                minimum: 1
              },
              'annotations': {
                type: 'array',
                description: 'Annotations that are allowed for entities, services and fields.',
                uniqueItems: true,
                items: {
                  type: 'string'
                }
              }
            }
          }
        }
      }
    }
  }
}