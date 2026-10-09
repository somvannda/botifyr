import * as RadixSelect from "@radix-ui/react-select";
import type { ReactNode } from "react";
import { CheckIcon, ChevronIcon } from "./Icons";

/**
 * A styled, accessible dropdown built on Radix Select (headless). Unlike a
 * native `<select>`, the open list is fully themed (no OS popup), so it matches
 * the rest of the design system in both light and dark themes.
 *
 * Radix forbids an empty-string item value, so `""` is mapped to an internal
 * sentinel and translated back — this keeps call sites able to use `""` for a
 * "none"/"You" option.
 */

const EMPTY = "__botifyr_empty__";
const toInternal = (value: string): string => (value === "" ? EMPTY : value);
const toExternal = (value: string): string => (value === EMPTY ? "" : value);

export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export function Select({
  value,
  defaultValue,
  onChange,
  options,
  placeholder,
  disabled,
  className,
  id,
  name,
  ariaLabel,
}: {
  /** Controlled value. */
  value?: string;
  /** Uncontrolled initial value. */
  defaultValue?: string;
  onChange?: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  /** Extra class (e.g. an existing bespoke select class) for sizing. */
  className?: string;
  id?: string;
  name?: string;
  ariaLabel?: string;
}) {
  return (
    <RadixSelect.Root
      value={value === undefined ? undefined : toInternal(value)}
      defaultValue={defaultValue === undefined ? undefined : toInternal(defaultValue)}
      onValueChange={(next) => onChange?.(toExternal(next))}
      disabled={disabled}
      name={name}
    >
      <RadixSelect.Trigger
        id={id}
        className={`select-trigger${className ? ` ${className}` : ""}`}
        aria-label={ariaLabel}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon className="select-chevron">
          <ChevronIcon size={14} />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content className="select-content" position="popper" sideOffset={4} collisionPadding={8}>
          <RadixSelect.ScrollUpButton className="select-scroll">
            <ChevronIcon size={14} />
          </RadixSelect.ScrollUpButton>
          <RadixSelect.Viewport className="select-viewport">
            {options.map((option) => (
              <RadixSelect.Item
                key={`${toInternal(option.value)}`}
                value={toInternal(option.value)}
                disabled={option.disabled}
                className="select-item"
              >
                <RadixSelect.ItemIndicator className="select-item-indicator">
                  <CheckIcon size={13} />
                </RadixSelect.ItemIndicator>
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
          <RadixSelect.ScrollDownButton className="select-scroll">
            <ChevronIcon size={14} />
          </RadixSelect.ScrollDownButton>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
