declare function ConverterFunction(expression: string): string
export type Converter = typeof ConverterFunction

export type Converters = {
  UUID: Converter
  String: Converter
  LargeString: Converter
  Binary: Converter
  LargeBinary: Converter
  Boolean: Converter
  Integer: Converter
  UInt8: Converter
  Int16: Converter
  Int32: Converter
  Int64: Converter
  Float: Converter
  Double: Converter
  Decimal: Converter
  DecimalFloat: Converter
  Date: Converter
  Time: Converter
  DateTime: Converter
  Timestamp: Converter
}
