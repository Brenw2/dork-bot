// Picking pictures on the phone: the camera or the photo library, shrunk to MAX_SIDE as JPEG.
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';
import { fitSize, MAX_IMAGES, type Attachment } from '@/lib/attachments';

export type PickSource = 'camera' | 'library';

/** What the + button offers on this device. */
export const PICK_SOURCES: { source: PickSource; label: string }[] = [
  { source: 'camera', label: 'Take photo' },
  { source: 'library', label: 'Choose from library' },
];

export async function pickImages(source: PickSource, already = 0): Promise<Attachment[]> {
  const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert(
      source === 'camera' ? 'Camera access is off' : 'Photo access is off',
      `Turn it on for Dork Bot in Settings to send ${source === 'camera' ? 'photos' : 'pictures'}.`,
    );
    return [];
  }
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 1,
    allowsMultipleSelection: source === 'library',
    selectionLimit: Math.max(1, MAX_IMAGES - already),
    exif: false,
  };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled) return [];
  const out: Attachment[] = [];
  for (const asset of result.assets) out.push(await shrink(asset.uri, asset.width, asset.height));
  return out;
}

async function shrink(uri: string, width: number, height: number): Promise<Attachment> {
  const size = fitSize(width, height);
  const ctx = ImageManipulator.ImageManipulator.manipulate(uri);
  if (size.width !== width) ctx.resize(size);
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress: 0.82, base64: true });
  return { dataUrl: `data:image/jpeg;base64,${saved.base64}`, width: saved.width, height: saved.height };
}

/** Phone: nothing to hook (no paste or drop of pictures into the chat). */
export function useImageDrop(_onImages: (images: Attachment[]) => void, _enabled: boolean): void {}
