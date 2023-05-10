using {managed} from '@sap/cds/common';

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
}
