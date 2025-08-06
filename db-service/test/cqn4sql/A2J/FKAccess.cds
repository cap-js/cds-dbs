// make sure we always optimize the FK access and not use the target key
service S {
    entity Books {
        key ID : Integer;
        title : String;
        authorAddress : Association to Authors { address };
        authorAddressFKRenamed : Association to Authors { address as bar };
        deeply: {
            nested {
                authorAddress: Association to Authors { address };
            }
        }
        toSelf: Association to Books { deeply.nested as baz }
    }

    entity Authors {
        key ID : Integer;
        name : String;
        address: Association to Addresses;
    }

    entity Addresses {
        key street : String;
        key number : Integer;
        key zip : String;
        key city : String;
    }
}
