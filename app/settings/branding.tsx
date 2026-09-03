import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Image,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import {
  BRAND_COLOR_SWATCHES,
  hasCompanyBranding,
  useInspectorProfileStore,
  type BrandColorKey,
} from '@/lib/stores/inspectorProfileStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/PressableScale';
import { FadeSlideIn } from '@/components/motion';
import { RichCard } from '@/components/ui/RichCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import {
  colors,
  fontSize,
  fontWeight,
  gradients,
  radii,
  spacing,
  touchTarget,
} from '@/theme/tokens';

const BRAND_COLOR_ORDER: BrandColorKey[] = ['royal', 'burnt', 'navy', 'success', 'purple', 'teal'];

export default function BrandingScreen() {
  const router = useRouter();
  const company = useInspectorProfileStore((s) => s.profile.company);
  const updateCompany = useInspectorProfileStore((s) => s.updateCompany);
  const toast = useToastStore((s) => s.show);
  const [pickingLogo, setPickingLogo] = useState(false);

  const pickLogo = async () => {
    if (pickingLogo) return;
    setPickingLogo(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        toast({
          tone: 'warn',
          title: 'Photo access needed',
          body: 'Allow photo library access to add a company logo.',
        });
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.9,
        allowsEditing: true,
        aspect: [1, 1],
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      // Small compressed thumbnail, self-contained as a data URI — PDF
      // generation never has to re-read a file that may not exist on this
      // device later (restored backup, other device). `logoUri` stays around
      // for the in-app preview only.
      const out = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 240 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      updateCompany({
        logoUri: asset.uri,
        logoBase64: out.base64 ? `data:image/jpeg;base64,${out.base64}` : undefined,
      });
    } catch {
      toast({ tone: 'danger', title: "Couldn't add that photo" });
    } finally {
      setPickingLogo(false);
    }
  };

  const removeLogo = () => updateCompany({ logoUri: undefined, logoBase64: undefined });

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Company branding" back />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <FadeSlideIn index={0}>
          <Text style={styles.help}>
            {hasCompanyBranding(company)
              ? 'Appears on every proposal, HAAG report, and long-form report.'
              : "Not set — reports print your inspector name only. Add a company name below to brand every document."}
          </Text>
        </FadeSlideIn>

        <Section index={1} title="Logo">
          <View style={styles.logoRow}>
            <View style={styles.logoPreviewWrap}>
              {company.logoBase64 ? (
                <Image source={{ uri: company.logoBase64 }} style={styles.logoPreview} />
              ) : (
                <View style={styles.logoPlaceholder}>
                  <Ionicons name="image-outline" size={22} color={colors.textSubtle} />
                </View>
              )}
            </View>
            <View style={{ flex: 1, gap: spacing.sm }}>
              <Pressable
                style={styles.logoBtn}
                onPress={pickLogo}
                disabled={pickingLogo}
                accessibilityRole="button"
                accessibilityLabel={company.logoBase64 ? 'Replace logo' : 'Add logo'}
              >
                {pickingLogo ? (
                  <ActivityIndicator color={colors.textInverse} />
                ) : (
                  <Text style={styles.logoBtnText}>
                    {company.logoBase64 ? 'Replace logo' : 'Add logo'}
                  </Text>
                )}
              </Pressable>
              {company.logoBase64 ? (
                <Pressable onPress={removeLogo} accessibilityRole="button" accessibilityLabel="Remove logo">
                  <Text style={styles.logoRemoveText}>Remove</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </Section>

        <Section index={2} title="Company">
          <Field
            label="Company name"
            value={company.name}
            onChangeText={(t) => updateCompany({ name: t })}
            placeholder="Robinson Roofing & Restoration"
          />
          <Sep />
          <Field
            label="Company license #"
            value={company.licenseNumber ?? ''}
            onChangeText={(t) => updateCompany({ licenseNumber: t })}
            placeholder="Optional"
            autoCapitalize="characters"
          />
          <Sep />
          <Field
            label="Insurance on file"
            value={company.insuranceLine ?? ''}
            onChangeText={(t) => updateCompany({ insuranceLine: t })}
            placeholder="e.g. General liability & workers' comp"
          />
        </Section>

        <Section index={3} title="Contact">
          <Field
            label="Phone"
            value={company.phone ?? ''}
            onChangeText={(t) => updateCompany({ phone: t })}
            placeholder="(555) 555-0100"
            keyboardType="phone-pad"
          />
          <Sep />
          <Field
            label="Email"
            value={company.email ?? ''}
            onChangeText={(t) => updateCompany({ email: t })}
            placeholder="office@yourcompany.com"
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <Sep />
          <Field
            label="Website"
            value={company.website ?? ''}
            onChangeText={(t) => updateCompany({ website: t })}
            placeholder="yourcompany.com"
            keyboardType="url"
            autoCapitalize="none"
          />
        </Section>

        <Section index={4} title="Brand color" footer="Accents your logo mark on report covers.">
          <View style={styles.swatchRow}>
            {BRAND_COLOR_ORDER.map((key) => {
              const swatch = BRAND_COLOR_SWATCHES[key];
              const selected = company.brandColor === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => updateCompany({ brandColor: key })}
                  accessibilityRole="button"
                  accessibilityLabel={`${swatch.label}${selected ? ', selected' : ''}`}
                  style={styles.swatchTouch}
                >
                  <View
                    style={[
                      styles.swatch,
                      { backgroundColor: swatch.hex },
                      selected && styles.swatchSelected,
                    ]}
                  >
                    {selected ? <Ionicons name="checkmark" size={18} color="#fff" /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Section>

        <FadeSlideIn index={5}>
          <PressableScale
            style={styles.doneBtnShadow}
            onPress={() => {
              toast({ tone: 'success', title: 'Branding saved' });
              router.back();
            }}
            accessibilityRole="button"
            accessibilityLabel="Done"
          >
            <LinearGradient
              colors={gradients.accent}
              style={styles.doneBtn}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <Text style={styles.doneBtnText}>Done</Text>
            </LinearGradient>
          </PressableScale>
        </FadeSlideIn>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({
  title,
  footer,
  index,
  children,
}: {
  title: string;
  footer?: string;
  index: number;
  children: React.ReactNode;
}) {
  return (
    <FadeSlideIn index={index} style={styles.section}>
      <SectionHeader title={title} style={styles.sectionHeaderSpacing} />
      <RichCard padded={false}>{children}</RichCard>
      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </FadeSlideIn>
  );
}

function Sep() {
  return <View style={styles.sep} />;
}

function Field({
  label,
  ...rest
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.fieldCell}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={styles.input} placeholderTextColor={colors.textSubtle} {...rest} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxxl,
    gap: spacing.xl,
  },
  help: {
    fontSize: fontSize.bodySm,
    color: colors.textSubtle,
    lineHeight: 18,
    paddingHorizontal: spacing.lg,
  },

  section: {},
  sectionHeaderSpacing: { marginBottom: spacing.sm, paddingHorizontal: spacing.lg },
  footer: {
    fontSize: fontSize.caption,
    color: colors.textSubtle,
    lineHeight: 16,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
    marginLeft: spacing.lg,
  },

  fieldCell: {
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
  },
  fieldLabel: {
    fontSize: fontSize.bodySm,
    color: colors.textMuted,
    fontWeight: fontWeight.medium,
  },
  input: {
    fontSize: fontSize.bodyLg,
    color: colors.text,
    paddingVertical: spacing.xs,
  },

  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  logoPreviewWrap: { borderRadius: radii.md, overflow: 'hidden' },
  logoPreview: { width: 64, height: 64, borderRadius: radii.md },
  logoPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoBtn: {
    height: touchTarget.standard,
    borderRadius: radii.pill,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  logoBtnText: { color: colors.textInverse, fontWeight: fontWeight.semibold, fontSize: fontSize.bodyMd },
  logoRemoveText: {
    color: colors.danger,
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.medium,
    textAlign: 'center',
  },

  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  swatchTouch: {
    minWidth: touchTarget.standard,
    minHeight: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatch: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchSelected: { borderColor: colors.text },

  doneBtnShadow: { borderRadius: radii.button },
  doneBtn: {
    height: touchTarget.sticky,
    borderRadius: radii.button,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnText: {
    color: colors.textInverse,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.bold,
  },
});
