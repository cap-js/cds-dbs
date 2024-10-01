using { cap as my } from '../db/schema';

@path: '/standard'
service TravelService {
  entity Travel as projection on my.Travel;
  entity Booking as projection on my.Booking;
  entity BookingSupplement as projection on my.BookingSupplement;
}

// duplicated composition with manipulated on condition
@path: '/on-cond'
service TravelService1 {
  entity Travel as projection on my.Travel {
    *,
    to_Booking: Composition of many Booking on to_Booking.to_Travel = $self and to_Booking.BookingDate >= $now,
    to_Past_Booking: Composition of many Booking on to_Past_Booking.to_Travel = $self and to_Past_Booking.BookingDate < $now
  };
  entity Booking as projection on my.Booking;
  entity BookingSupplement as projection on my.BookingSupplement;
}

// duplicated composition with additional projections
@path: '/add-projection'
service TravelService2 {
  entity Travel as projection on my.Travel {
    *,
    to_Booking: Composition of many Booking on to_Booking.to_Travel = $self,
    to_Past_Booking: Composition of many PastBooking on to_Past_Booking.to_Travel = $self
  };
  @cds.redirection.target
  entity Booking as projection on my.Booking where BookingDate >= $now;
  entity PastBooking as projection on my.Booking where BookingDate < $now;
  entity BookingSupplement as projection on my.BookingSupplement;
}

// mixin a new composition
@path: '/mixin'
service TravelService3 {
  entity Travel as select from my.Travel mixin {
    to_Invoice: Composition of many Invoice on ID = to_Invoice.to_Travel.ID
  } into { *, to_Invoice };
  entity Booking as projection on my.Booking;
  entity BookingSupplement as projection on my.BookingSupplement;

  entity Invoice {
    key ID: UUID;
    to_Travel: Association to Travel;
    total: Integer;
    descr: String;
  }
}

// hide compositions
@path: '/plain-travel'
service TravelService4 {
  entity Travel as select from my.Travel {
    ID,
    TravelID,
    Description
  }

// TODO: flattened composition unfolds to deep
-> spec meeting
}