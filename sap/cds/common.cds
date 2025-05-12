/**
 * Type for an association to Languages
 *
 * See https://cap.cloud.sap/docs/cds/common#type-language
 */
type Language : Association to sap.common.Languages;

/**
 * Type for an association to Currencies
 *
 * See https://cap.cloud.sap/docs/cds/common#type-currency
 */
type Currency : Association to sap.common.Currencies;

/**
 * Type for an association to Countries
 *
 * See https://cap.cloud.sap/docs/cds/common#type-country
 */
type Country : Association to sap.common.Countries;

/**
 * Type for an association to Timezones
 *
 * See https://cap.cloud.sap/docs/cds/common#type-timezone
 */
type Timezone : Association to sap.common.Timezones;

/**
 * Entities to serve the reuse types with extensible code lists
 * including built-in support for value lists in Fiori.
 */
context sap.common {
  /**
   * Type for a language code
   */
  type Locale : String(14) @(title : '{i18n>LanguageCode}');
    //> length=14 is to accommodate values like these:
    // en_US_x_saptrc - (1Q) used as a technical SAP language code
    // en_US_x_sappsd - (2Q) used as a technical SAP language code

  /**
   * Code list for languages
   *
   * See https://cap.cloud.sap/docs/cds/common#entity-languages
   */
  entity Languages : CodeList {
    key code : Locale;
  }

  /**
   * Code list for countries
   *
   * See https://cap.cloud.sap/docs/cds/common#entity-countries
   */
  entity Countries : CodeList {
    key code : String(3) @(title : '{i18n>CountryCode}');
  }

  /**
   * Code list for currencies
   *
   * See https://cap.cloud.sap/docs/cds/common#entity-currencies
   */
  entity Currencies : CodeList {
    key code      : String(3) @(title : '{i18n>CurrencyCode}');
        symbol    : String(5) @(title : '{i18n>CurrencySymbol}');
        minorUnit : Int16     @(title : '{i18n>CurrencyMinorUnit}');
  }

  /**
   * Code list for time zones
   *
   * See https://cap.cloud.sap/docs/cds/common#entity-timezones
   */
  entity Timezones : CodeList {
    key code : String(100) @(title: '{i18n>TimeZoneCode}');
  }

  /**
   * Aspect for a code list with name and description
   *
   * See https://cap.cloud.sap/docs/cds/common#aspect-codelist
   */
  aspect CodeList @(
    cds.autoexpose,
    cds.persistence.skip : 'if-unused'
  ) {
    name  : localized String(255)  @title : '{i18n>Name}';
    descr : localized String(1000) @title : '{i18n>Description}';
  }

  /*
   * Aspect that is included by generated `.texts` entities for localized entities.
   */
  aspect TextsAspect {
    key locale: Locale;
  }
}


/**
 * Aspect for entities with canonical universal IDs
 *
 * See https://cap.cloud.sap/docs/cds/common#aspect-cuid
 */
aspect cuid {
  key ID : UUID; //> automatically filled in
}

/**
 * Aspect to capture changes by user and name
 *
 * See https://cap.cloud.sap/docs/cds/common#aspect-managed
 */
aspect managed {
  createdAt  : Timestamp @cds.on.insert : $now;
  createdBy  : User      @cds.on.insert : $user;
  modifiedAt : Timestamp @cds.on.insert : $now  @cds.on.update : $now;
  modifiedBy : User      @cds.on.insert : $user @cds.on.update : $user;
}

/**
 * Aspect for entities with temporal data
 *
 * See https://cap.cloud.sap/docs/cds/common#aspect-temporal
 */
aspect temporal {
  validFrom : Timestamp @cds.valid.from;
  validTo   : Timestamp @cds.valid.to;
}


/**
 * Canonical user ID
 */
type User : String(255);


//---------------------------------------------------------------------------
// Annotations for Fiori UIs...

annotate sap.common.CodeList with @UI.Identification : [{Value:name}];
annotate sap.common.CodeList with @cds.odata.valuelist;

annotate managed with {
  createdAt  @UI.HiddenFilter @UI.ExcludeFromNavigationContext;
  createdBy  @UI.HiddenFilter @UI.ExcludeFromNavigationContext;
  modifiedAt @UI.HiddenFilter @UI.ExcludeFromNavigationContext;
  modifiedBy @UI.HiddenFilter @UI.ExcludeFromNavigationContext;
}

annotate managed with {
  createdAt  @Core.Immutable;
  createdBy  @Core.Immutable;
}

annotate sap.common.Countries  with { code @Common.Text:name; }
annotate sap.common.Currencies with { code @Common.Text:name; }
annotate sap.common.Languages  with { code @Common.Text:name; }


//---------------------------------------------------------------------------
// Common Annotations...

annotate Language with @(
  title       : '{i18n>Language}',
  description : '{i18n>LanguageCode.Description}'
);

annotate Currency with @(
  title       : '{i18n>Currency}',
  description : '{i18n>CurrencyCode.Description}'
);

annotate Country with @(
  title       : '{i18n>Country}',
  description : '{i18n>CountryCode.Description}'
);

annotate User with @(
  title       : '{i18n>UserID}',
  description : '{i18n>UserID.Description}'
);

annotate managed with {
  createdAt  @title : '{i18n>CreatedAt}';
  createdBy  @title : '{i18n>CreatedBy}';
  modifiedAt @title : '{i18n>ChangedAt}';
  modifiedBy @title : '{i18n>ChangedBy}';
}


//---------------------------------------------------------------------------
// Temporary Workarounds...
// REVISIT: @cds.on... should automatically result in @readonly @Core.Computed

annotate managed with {
  modifiedAt @readonly;
  createdAt  @readonly;
  createdBy  @readonly;
  modifiedBy @readonly;
}

//---------------------------------------------------------------------------