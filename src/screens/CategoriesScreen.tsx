import React, {useState, useEffect} from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Modal,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAuth} from '../contexts/AuthContext';
import {useColors} from '../hooks/useColors';
import {getCategories, addCategory, deleteCategory} from '../lib/database';
import type {Category, TransactionType} from '../types';

const COLORS = [
  '#FF6B35', '#4ECDC4', '#45B7D1', '#FF6B6B', '#FED766', '#A78BFA',
  '#FBBF24', '#8B5CF6', '#F472B6', '#60A5FA', '#10B981', '#3B82F6',
  '#F59E0B', '#EF4444', '#EC4899', '#14B8A6',
];
const ICONS = [
  'restaurant-outline', 'car-outline', 'home-outline', 'medkit-outline',
  'bag-outline', 'game-controller-outline', 'flash-outline', 'book-outline',
  'cut-outline', 'airplane-outline', 'briefcase-outline', 'laptop-outline',
  'trending-up-outline', 'cash-outline', 'business-outline',
  'add-circle-outline', 'heart-outline', 'gift-outline', 'fitness-outline',
  'cafe-outline', 'musical-notes-outline', 'tv-outline', 'film-outline',
  'paw-outline',
];

export default function CategoriesScreen() {
  const {session} = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TransactionType | 'all'>('all');
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [catType, setCatType] = useState<TransactionType>('expense');
  const [selColor, setSelColor] = useState(COLORS[0]);
  const [selIcon, setSelIcon] = useState(ICONS[0]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!session) return;
    const cats = await getCategories(session.user.id);
    setCategories(cats);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [session?.user.id]);

  const filtered = categories.filter(
    c => filter === 'all' || c.type === filter || c.type === 'both',
  );

  const handleAdd = async () => {
    if (!name.trim()) {
      Alert.alert('Invalid', 'Category name is required.');
      return;
    }
    setSaving(true);
    try {
      await addCategory({
        user_id: session!.user.id,
        name: name.trim(),
        type: catType,
        color: selColor,
        icon: selIcon,
        is_default: false,
      });
      setShowModal(false);
      setName('');
      await load();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
    setSaving(false);
  };

  const handleDelete = (c: Category) => {
    if (c.is_default) {
      Alert.alert('Cannot delete', 'Default categories cannot be deleted.');
      return;
    }
    Alert.alert('Delete Category', `Delete "${c.name}"?`, [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteCategory(c.id);
          await load();
        },
      },
    ]);
  };

  return (
    <View style={[styles.root, {backgroundColor: colors.background}]}>
      <View style={[styles.header, {paddingTop: insets.top + 12}]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icon name="arrow-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, {color: colors.foreground}]}>
          Categories
        </Text>
        <TouchableOpacity onPress={() => setShowModal(true)}>
          <Icon name="add-circle-outline" size={26} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.chips}>
        {(['all', 'expense', 'income'] as const).map(f => (
          <TouchableOpacity
            key={f}
            style={[
              styles.chip,
              {
                backgroundColor: filter === f ? colors.primary : colors.card,
                borderColor: filter === f ? colors.primary : colors.border,
              },
            ]}
            onPress={() => setFilter(f)}>
            <Text
              style={[
                styles.chipText,
                {color: filter === f ? '#fff' : colors.mutedForeground},
              ]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{marginTop: 40}} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={c => c.id}
          renderItem={({item: c}) => (
            <View
              style={[
                styles.row,
                {backgroundColor: colors.card, borderColor: colors.border},
              ]}>
              <View style={[styles.icon, {backgroundColor: c.color + '20'}]}>
                <Icon name={c.icon as any} size={20} color={c.color} />
              </View>
              <View style={styles.info}>
                <Text style={[styles.name, {color: colors.foreground}]}>
                  {c.name}
                </Text>
                <Text
                  style={[styles.type, {color: colors.mutedForeground}]}>
                  {c.type}
                </Text>
              </View>
              {!c.is_default && (
                <TouchableOpacity onPress={() => handleDelete(c)}>
                  <Icon
                    name="trash-outline"
                    size={18}
                    color={colors.mutedForeground}
                  />
                </TouchableOpacity>
              )}
            </View>
          )}
          contentContainerStyle={[
            styles.list,
            {paddingBottom: insets.bottom + 40},
          ]}
          showsVerticalScrollIndicator={false}
        />
      )}

      <Modal
        visible={showModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowModal(false)}>
        <View style={[styles.modalRoot, {backgroundColor: colors.background}]}>
          <View
            style={[styles.modalHeader, {borderBottomColor: colors.border}]}>
            <Text style={[styles.modalTitle, {color: colors.foreground}]}>
              New Category
            </Text>
            <TouchableOpacity onPress={() => setShowModal(false)}>
              <Icon name="close" size={24} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          <View style={styles.modalBody}>
            <Text style={[styles.label, {color: colors.mutedForeground}]}>
              Type
            </Text>
            <View
              style={[styles.typeToggle, {backgroundColor: colors.muted}]}>
              {(['expense', 'income'] as TransactionType[]).map(t => (
                <TouchableOpacity
                  key={t}
                  style={[
                    styles.typeBtn,
                    catType === t && {backgroundColor: colors.card},
                  ]}
                  onPress={() => setCatType(t)}>
                  <Text
                    style={[
                      styles.typeBtnText,
                      {
                        color:
                          catType === t ? colors.primary : colors.mutedForeground,
                      },
                    ]}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.label, {color: colors.mutedForeground}]}>
              Name
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.input,
                  borderColor: colors.border,
                  color: colors.foreground,
                },
              ]}
              placeholder="Category name"
              placeholderTextColor={colors.mutedForeground}
              value={name}
              onChangeText={setName}
            />

            <Text style={[styles.label, {color: colors.mutedForeground}]}>
              Color
            </Text>
            <View style={styles.colorGrid}>
              {COLORS.map(c => (
                <TouchableOpacity
                  key={c}
                  style={[
                    styles.colorDot,
                    {backgroundColor: c},
                    selColor === c && {
                      borderWidth: 3,
                      borderColor: colors.foreground,
                    },
                  ]}
                  onPress={() => setSelColor(c)}
                />
              ))}
            </View>

            <Text style={[styles.label, {color: colors.mutedForeground}]}>
              Icon
            </Text>
            <View style={styles.iconGrid}>
              {ICONS.map(ic => (
                <TouchableOpacity
                  key={ic}
                  style={[
                    styles.iconDot,
                    {
                      backgroundColor:
                        selIcon === ic ? selColor + '25' : colors.muted,
                      borderColor:
                        selIcon === ic ? selColor : 'transparent',
                      borderWidth: 2,
                    },
                  ]}
                  onPress={() => setSelIcon(ic)}>
                  <Icon
                    name={ic as any}
                    size={20}
                    color={
                      selIcon === ic ? selColor : colors.mutedForeground
                    }
                  />
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[
                styles.saveBtn,
                {
                  backgroundColor: colors.primary,
                  opacity: saving ? 0.7 : 1,
                },
              ]}
              onPress={handleAdd}
              disabled={saving}>
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.saveBtnText}>Create Category</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 12,
  },
  title: {flex: 1, fontSize: 22, fontWeight: '700'},
  chips: {flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 12},
  chip: {paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, borderWidth: 1},
  chipText: {fontSize: 13, fontWeight: '500'},
  list: {paddingHorizontal: 16, gap: 8},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {flex: 1},
  name: {fontSize: 14, fontWeight: '600'},
  type: {
    fontSize: 12,
    fontWeight: '400',
    textTransform: 'capitalize',
  },
  modalRoot: {flex: 1},
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
  },
  modalTitle: {fontSize: 18, fontWeight: '700'},
  modalBody: {padding: 20},
  label: {
    fontSize: 12,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 14,
  },
  typeToggle: {flexDirection: 'row', borderRadius: 10, padding: 3},
  typeBtn: {flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8},
  typeBtnText: {fontSize: 14, fontWeight: '600'},
  input: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 46,
    fontSize: 15,
    fontWeight: '400',
  },
  colorGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 10},
  colorDot: {width: 30, height: 30, borderRadius: 15},
  iconGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  iconDot: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtn: {
    height: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  saveBtnText: {color: '#fff', fontSize: 16, fontWeight: '600'},
});
