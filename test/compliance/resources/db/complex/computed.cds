namespace complex.computed;

entity static {
  value   : Integer;
  integer : Integer = 1;
  double  : Double  = 0.1;
  string  : String  = '';
}

entity dynamic {
  integer : Integer;
  @(Core.Computed: true,readonly)
  ![case] : String = (
    case
      when
        integer = 0
      then
        'zero'
      when
        integer = 1
      then
        'one'
      when
        integer = 2
      then
        'two'
    end
  );
  lambda  : String = (integer = 0 ? 'none' : 'some')
}
