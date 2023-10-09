(module
  (memory (import "js" "mem") 1)
  (func $find (param $start i32) (param $target i32) (param $char i32) (result i32 i32)
    (local $index i32)
    local.get $start
    i32.const 1
    i32.add
    local.set $index
    (block $return
      (loop $step
        ;; return when $index is 0
        local.get $index
        i32.eqz
        br_if $return
        ;; sub one to $index
        local.get $index
        i32.const 1
        i32.sub
        ;; update $index
        local.tee $index
        ;; load character at $index
        i32.load8_u
        ;; check if the character is $char
        local.get $char
        i32.ne
        br_if $step
      )
    )
    local.get $index
    local.get $target
  )
  (func $copy (param $start i32) (param $end i32) (param $target i32) (result i32 i32)
    (local $length i32)
    local.get $end
    local.get $start
    i32.sub
    local.set $length

    ;; Add quote
    local.get $target
    i32.const 1
    i32.sub
    local.tee $target
    i32.const 34 ;; '"'
    i32.store8

    ;; move target location
    local.get $target
    local.get $length
    i32.sub
    local.tee $target
    ;; Copy data to target
    local.get $start
    local.get $length
    memory.copy

    ;; Add quote
    local.get $target
    i32.const 1
    i32.sub
    local.tee $target
    i32.const 34 ;; '"'
    i32.store8

    local.get $start
    local.get $target
  )
  (func $parse (param $end i32) (param $target i32) (result i32 i32)
    (local $index i32)
    (local $start i32)
    (local $endKey i32)
    (local $startKey i32)
    (local $endVal i32)
    (local $startVal i32)
    local.get $end
    i32.const 2
    i32.sub
    local.tee $index
    i32.load8_u
    ;; Check if the last column is '2'
    i32.const 50
    i32.eq
    (if
      (then
        ;; Find next semicolon
        local.get $index
        local.get $target
        i32.const 59 ;; ';'
        call $find
        local.set $target
        ;; Track the end of the value
        local.tee $endKey
        local.tee $index
        local.get $target
        i32.const 32 ;; ' '
        call $find
        local.set $target
        local.tee $index
        i32.const 1
        i32.add ;; add one to remove the found space
        local.set $startKey

        ;; Find next semicolon
        local.get $index
        local.get $target
        i32.const 59 ;; ';'
        call $find
        local.set $target
        i32.const 1
        i32.sub
        local.tee $index
        local.get $target
        ;; Find next semicolon
        i32.const 59 ;; ';'
        call $find
        local.set $target
        ;; Track the end of the value
        local.tee $endVal
        local.tee $index
        local.get $target
        i32.const 32 ;; ' '
        call $find
        local.set $target
        local.tee $index
        i32.const 1
        i32.add ;; add one to remove the found space
        local.set $startVal

        ;; Add comma
        local.get $target
        i32.const 1
        i32.sub
        local.tee $target
        i32.const 44 ;; ','
        i32.store8

        ;; Copy data to target
        local.get $startVal
        local.get $endVal
        local.get $target
        call $copy
        local.set $target
        local.set $index

        ;; Add colon
        local.get $target
        i32.const 1
        i32.sub
        local.tee $target
        i32.const 58 ;; ':'
        i32.store8

        ;; Copy data to target
        local.get $startKey
        local.get $endKey
        local.get $target
        call $copy
        local.set $target
        local.set $index
      )
    )

    local.get $index
    local.get $target
  )
  (func (export "extract") (param $start i32) (result i32)
    (local $index i32)
    (local $target i32)
    local.get $start
    local.tee $index
    local.set $target

    ;; Create return block
    (block $ret
      (loop $line
        ;; Align to the next line
        local.get $index
        local.get $target
        i32.const 10
        call $find
        local.set $target
        local.set $index

        ;; Return when the $index is 0
        local.get $index
        i32.eqz
        br_if $ret

        ;; Parse the next line
        local.get $index
        local.get $target
        call $parse
        local.set $target
        local.set $index
        br $line
      )
    )
    ;; return the length of the parsed results
    local.get $target
  )
)
