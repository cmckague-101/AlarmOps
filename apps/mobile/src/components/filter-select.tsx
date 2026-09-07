import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppSymbol } from '@/components/app-symbol';
import { FireOpsTheme, useFireOpsTheme } from '@/theme';

export type FilterSelectOption<T extends string> = {
  label: string;
  value: T;
};

type Props<T extends string> = {
  accessibilityLabel: string;
  onChange: (value: T) => void;
  options: readonly FilterSelectOption<T>[];
  value: T;
};

export function FilterSelect<T extends string>({ accessibilityLabel, onChange, options, value }: Props<T>) {
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [open, setOpen] = useState(false);
  const selectedLabel = options.find((option) => option.value === value)?.label ?? value;

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityHint="Opens selection options"
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((current) => !current)}
        style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
      >
        <Text style={styles.triggerLabel}>{selectedLabel}</Text>
        <AppSymbol name={open ? 'chevron.up' : 'chevron.down'} color={theme.secondary} size={15} />
      </Pressable>

      {open ? (
        <View style={styles.menu}>
          {options.map((option, index) => {
            const selected = option.value === value;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={option.value}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={({ pressed }) => [
                  styles.option,
                  index > 0 && styles.optionBorder,
                  selected && styles.optionSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>{option.label}</Text>
                {selected ? <AppSymbol name="checkmark" color={theme.green} size={16} /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function createStyles(theme: FireOpsTheme) {
  return StyleSheet.create({
    container: { gap: 6 },
    trigger: {
      minHeight: 46,
      borderWidth: 1,
      borderColor: theme.divider,
      borderRadius: 12,
      backgroundColor: theme.paper,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    triggerLabel: { flex: 1, color: theme.ink, fontSize: 15, lineHeight: 20, fontWeight: '700' },
    menu: {
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: theme.divider,
      borderRadius: 12,
      backgroundColor: theme.paper,
    },
    option: {
      minHeight: 44,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    optionBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider },
    optionSelected: { backgroundColor: theme.greenSurface },
    optionLabel: { flex: 1, color: theme.ink, fontSize: 14, lineHeight: 20, fontWeight: '600' },
    optionLabelSelected: { color: theme.green, fontWeight: '800' },
    pressed: { opacity: 0.72 },
  });
}
