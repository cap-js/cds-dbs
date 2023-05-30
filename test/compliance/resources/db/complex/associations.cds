namespace complex.associations;

using { Language, Country, Currency, cuid, managed as cdsManaged, temporal } from '@sap/cds/common';

annotate sap.common with @compliance.ignore;

context common {
  entity common : cuid, cdsManaged, temporal {
    language: Language;
    country: Country;
    currency: Currency;
  }
}

context managed {
  entity child: cuid {}

  entity parent: cuid {
    child: Association to one child;
  }
}

context mixed {
  entity child: cuid {
    parent: Association to one parent;
  }

  entity parent: cuid {
    children: Association to many child on children.parent = $self;
  }
}

context unmanaged {
  entity child: cuid {
    parent_ID: UUID;
  }

  entity parent: cuid {
    children: Association to many child on children.parent_ID = ID;
  }
}
