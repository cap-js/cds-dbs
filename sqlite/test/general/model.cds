using {managed} from '@sap/cds/common';

@path: '/test'
service test {
    entity foo : managed {
        key ID         : Integer;
    }

    entity bar {
        key ID : UUID;
    }

    entity fooLocalized {
        key ID   : Integer;
            text : localized String;
    }

    entity Images {
        key ID   : Integer;
            data : LargeBinary @Core.MediaType: 'image/jpeg';
    }
}
