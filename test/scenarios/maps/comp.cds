using {cuid} from '@sap/cds/common';

entity Map : cuid {
  map : Composition of many {
          key ![key] : String(255);
              value  : String(5000);
        }
}
