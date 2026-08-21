import React from 'react';
import {StyleSheet, Text, TextInput, TextInputProps, View} from 'react-native';
import {colors, radii, spacing, typography} from '../theme';

type Props = TextInputProps & {label: string; hint?: string; error?: string};

export function FormField({label, hint, error, multiline, style, ...props}: Props) {
  return <View style={styles.wrapper}>
    <Text style={styles.label}>{label}</Text>
    <TextInput placeholderTextColor={colors.muted} multiline={multiline} style={[styles.input, multiline && styles.multiline, error && styles.inputError, style]} {...props}/>
    {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  wrapper: {marginBottom: spacing.md},
  label: {...typography.label, color: colors.text, marginBottom: spacing.sm},
  input: {...typography.body, minHeight: 48, backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, color: colors.text, paddingHorizontal: spacing.md, paddingVertical: spacing.md},
  multiline: {minHeight: 104, textAlignVertical: 'top'},
  inputError: {borderColor: colors.red},
  hint: {...typography.caption, color: colors.muted, marginTop: spacing.xs},
  error: {...typography.caption, color: colors.red, marginTop: spacing.xs},
});
