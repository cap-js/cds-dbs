type abap.sstring : String;

// add a service
@cds.external
service abap {
    @readonly: true
    entity Airline {
        key AirlineID         : abap.sstring(3);
            Name              : abap.sstring(40);
            CurrencyCode_code : abap.sstring(3);
            AirlinePicURL     : abap.sstring(1000);
    }

    @readonly: true
    entity Passenger {
        key CustomerID       : abap.sstring(6);
            FirstName        : abap.sstring(40);
            LastName         : abap.sstring(40);
            Title            : abap.sstring(10);
            Street           : abap.sstring(60);
            PostalCode       : abap.sstring(10);
            City             : abap.sstring(40);
            CountryCode_code : abap.sstring(3);
            PhoneNumber      : abap.sstring(30);
            EMailAddress     : abap.sstring(256);

            AgenciesInMyCity : Association to one TravelAgency
                                   on AgenciesInMyCity.City = City;
    }

    @readonly: true
    entity TravelAgency {
        key AgencyID         : abap.sstring(6);
            Name             : abap.sstring(80);
            Street           : abap.sstring(60);
            PostalCode       : abap.sstring(10);
            City             : abap.sstring(40);
            CountryCode_code : abap.sstring(3);
            PhoneNumber      : abap.sstring(30);
            EMailAddress     : abap.sstring(256);
            WebAddress       : abap.sstring(256);
    };

};
