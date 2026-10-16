using {
  managed,
  temporal
} from '@sap/cds/common';

entity db.fooTemporal : managed, temporal {
  key ID   : Integer;
}

entity db.fooManaged : managed {
  key ID    : Integer;
      value : String;
}

@path: '/test'
service test {
  entity foo : managed {
    key ID : Integer;
    defaultValue: Integer default 100;
  }

  entity bar {
    key ID : UUID;
  }

  entity BooksWithAssocAsKey {
    key author: Association to AuthorAssoc;
    title  : String;
    stock  : Integer;
  }

  entity AuthorAssoc {
    key ID: UUID;
  }

  entity fooLocalized {
    key ID   : Integer;
        text : localized String;
  }

  entity fooTemporal as projection on db.fooTemporal;

  // Projection that intentionally excludes the managed fields
  // (createdBy/createdAt/modifiedBy/modifiedAt) — see issue 20583.
  entity fooManagedRestricted as projection on db.fooManaged {
    ID,
    value
  };

  entity Images {
     key ID   : Integer;
         data : LargeBinary @Core.MediaType: 'image/jpeg';
         data2 : LargeBinary @Core.MediaType: 'image/jpeg';
  }

  entity ImagesView  as projection on Images {
    *,
    data as renamedData
  }
}
