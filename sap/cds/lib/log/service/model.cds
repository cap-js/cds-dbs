@protocol: 'rest'
service LogService {

  entity Loggers {
    key id : String;
    level  : String;
  }

  action format ($body : LogFormat);
  action debug (module : String) returns Loggers;
  action reset (module : String) returns Loggers;

}

type LogFormat {
  timestamp : Boolean;
  level     : Boolean;
  tenant    : Boolean;
  reqid     : Boolean;
  module    : Boolean;
}