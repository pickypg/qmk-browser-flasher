// Manual USB descriptor fetching (standard USB 2.0 descriptors, not
// DFU-specific). Needed because WebUSB's automatic string-descriptor
// resolution (USBAlternateInterface.interfaceName) is spec'd as a SHOULD,
// not a MUST — in practice some devices/browser combinations leave it
// null, so falling back to fetching it ourselves via GET_DESCRIPTOR is
// necessary to reliably read a DfuSe device's memory-layout string.

const GET_DESCRIPTOR = 6;
const DESCRIPTOR_TYPE_STRING = 0x03;
const DESCRIPTOR_TYPE_CONFIGURATION = 0x02;
const DESCRIPTOR_TYPE_INTERFACE = 0x04;

async function getDescriptor(device: USBDevice, type: number, index: number, langIdOrZero: number, length: number): Promise<DataView> {
  const result = await device.controlTransferIn(
    { requestType: "standard", recipient: "device", request: GET_DESCRIPTOR, value: (type << 8) | index, index: langIdOrZero },
    length,
  );
  if (result.status !== "ok" || !result.data) {
    throw new Error(`GET_DESCRIPTOR(type=${type}, index=${index}) failed: ${result.status}`);
  }
  return result.data;
}

export async function getConfigurationDescriptor(device: USBDevice): Promise<DataView> {
  const header = await getDescriptor(device, DESCRIPTOR_TYPE_CONFIGURATION, 0, 0, 9);
  const totalLength = header.getUint16(2, true);
  return getDescriptor(device, DESCRIPTOR_TYPE_CONFIGURATION, 0, 0, totalLength);
}

export async function getDefaultLangId(device: USBDevice): Promise<number> {
  const header = await getDescriptor(device, DESCRIPTOR_TYPE_STRING, 0, 0, 2);
  const full = await getDescriptor(device, DESCRIPTOR_TYPE_STRING, 0, 0, header.getUint8(0));
  return full.getUint16(2, true);
}

export async function getStringDescriptor(device: USBDevice, index: number, langId: number): Promise<string> {
  const header = await getDescriptor(device, DESCRIPTOR_TYPE_STRING, index, langId, 2);
  const length = header.getUint8(0);
  const full = await getDescriptor(device, DESCRIPTOR_TYPE_STRING, index, langId, length);
  const chars: number[] = [];
  for (let i = 2; i < length; i += 2) {
    chars.push(full.getUint16(i, true));
  }
  return String.fromCharCode(...chars);
}

/** Walks a raw configuration descriptor (standard USB TLV format: each
 * sub-descriptor is [bLength, bDescriptorType, ...]) to find the iInterface
 * string-descriptor index for a given interface/alternate-setting pair. */
export function findInterfaceStringIndex(configDescriptor: DataView, interfaceNumber: number, alternateSetting: number): number | undefined {
  let offset = 0;
  while (offset + 2 <= configDescriptor.byteLength) {
    const bLength = configDescriptor.getUint8(offset);
    if (bLength === 0) {
      break;
    }
    const bDescriptorType = configDescriptor.getUint8(offset + 1);
    if (bDescriptorType === DESCRIPTOR_TYPE_INTERFACE && bLength >= 9) {
      const bInterfaceNumber = configDescriptor.getUint8(offset + 2);
      const bAlternateSetting = configDescriptor.getUint8(offset + 3);
      if (bInterfaceNumber === interfaceNumber && bAlternateSetting === alternateSetting) {
        return configDescriptor.getUint8(offset + 8);
      }
    }
    offset += bLength;
  }
  return undefined;
}
