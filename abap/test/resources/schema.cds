type abap.sstring : String;
 
@cds.external : true
// service ![/ITAPC1/SQL_FLIGHTS_1] {

  @cds.persistence.exists : true
  @readonly : true
  @readonly : true
  entity Airline {
    key AirlineID : abap.sstring(3);
    Name : abap.sstring(40);
    CurrencyCode_code : abap.sstring(3);
    AirlinePicURL : abap.sstring(1000);
  };
 
  @cds.persistence.exists : true
  @readonly : true
  entity Passenger {
    key CustomerID : abap.sstring(6);
    FirstName : abap.sstring(40);
    LastName : abap.sstring(40);
    Title : abap.sstring(10);
    Street : abap.sstring(60);
    PostalCode : abap.sstring(10);
    City : abap.sstring(40);
    CountryCode_code : abap.sstring(3);
    PhoneNumber : abap.sstring(30);
    EMailAddress : abap.sstring(256);

    AgenciesInMyCity : Association to one TravelAgency on AgenciesInMyCity.City = City;
  };
 
  @cds.persistence.exists : true
  @readonly : true
  entity TravelAgency {
    key AgencyID : abap.sstring(6);
    Name : abap.sstring(80);
    Street : abap.sstring(60);
    PostalCode : abap.sstring(10);
    City : abap.sstring(40);
    CountryCode_code : abap.sstring(3);
    PhoneNumber : abap.sstring(30);
    EMailAddress : abap.sstring(256);
    WebAddress : abap.sstring(256);
  };
 
// }