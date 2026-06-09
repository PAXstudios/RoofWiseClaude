import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuthStore } from '@/lib/auth/authStore';
import { colors } from '@/theme/tokens';

export default function Index() {
  const initialized = useAuthStore((s) => s.initialized);
  const session = useAuthStore((s) => s.session);

  if (!initialized) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return <Redirect href={session ? '/(tabs)' : '/welcome'} />;
}

const styles = StyleSheet.create({
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
});
