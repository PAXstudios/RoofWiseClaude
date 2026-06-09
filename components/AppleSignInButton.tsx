import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useAuthStore } from '@/lib/auth/authStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { spacing } from '@/theme/tokens';

type Props = {
  width?: number | string;
};

export function AppleSignInButton({ width = '100%' }: Props) {
  const signInWithAppleIdToken = useAuthStore((s) => s.signInWithAppleIdToken);
  const toast = useToastStore((s) => s.show);
  const [available, setAvailable] = useState<boolean | null>(null);

  // expo-apple-authentication is iOS-only
  if (Platform.OS !== 'ios') return null;

  AppleAuthentication.isAvailableAsync()
    .then((ok) => setAvailable(ok))
    .catch(() => setAvailable(false));

  if (available === false) return null;

  return (
    <View style={[styles.wrap, { width: width as any }]}>
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={32}
        style={styles.button}
        onPress={async () => {
          try {
            const credential = await AppleAuthentication.signInAsync({
              requestedScopes: [
                AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
                AppleAuthentication.AppleAuthenticationScope.EMAIL,
              ],
            });
            if (!credential.identityToken) {
              throw new Error('Apple did not return an identity token.');
            }
            await signInWithAppleIdToken(credential.identityToken);
          } catch (e: any) {
            if (e?.code === 'ERR_REQUEST_CANCELED') return;
            toast({
              tone: 'danger',
              title: 'Apple Sign In failed',
              body:
                e instanceof Error
                  ? e.message
                  : 'Confirm Sign in with Apple is enabled in your Supabase project.',
            });
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginVertical: spacing.sm },
  button: { height: 56 },
});
