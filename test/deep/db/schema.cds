using { cuid, managed } from '@sap/cds/common';

namespace cap;

entity Travel : cuid, managed {
  TravelID       : Integer @readonly default 0;
  Description    : String(1024);
  to_Booking     : Composition of many Booking on to_Booking.to_Travel = $self;
};

entity Booking : cuid, managed {
  BookingID         : Integer @Core.Computed;
  BookingDate       : Date;
  to_BookSupplement : Composition of many BookingSupplement on to_BookSupplement.to_Booking = $self;
  to_Travel: Association to one Travel;
};

entity BookingSupplement : cuid, managed {
  BookingSupplementID : Integer @Core.Computed;
  Price               : Decimal(16, 3);
  to_Booking: Association to one Booking;
};
