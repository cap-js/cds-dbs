using {
  managed,
  temporal
} from '@sap/cds/common';

entity db.fooTemporal : managed, temporal {
  key ID   : Integer;
}

@path: '/test'
service test {
  entity foo : managed {
    key ID : Integer;
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
