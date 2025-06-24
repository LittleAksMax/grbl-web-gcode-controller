/////////////////////////////
/// CONNECTION MANAGEMENT ///
/////////////////////////////

const BAUD_RATE = 115200; // hard-coded for grbl
const USB_PRODUCT_ID = 29987; // specific for machine
const USB_VENDOR_ID = 6790; // specific for machine

/**
 * Event for when new USB is plugged in.
 */
navigator.serial.addEventListener('connect', async (e) => {
  // Connect to `e.target` or add it to a list of available ports.
  console.debug('Connect');
  console.debug(e);
});

navigator.serial.addEventListener('disconnect', async (e) => {
  // Remove `e.target` from the list of available ports.
  console.debug('Disconnect');
  console.debug(e);
});

/**
 * Look at paired ports on render.
 */
document.addEventListener('DOMContentLoaded', async () => {
  // NOTE: we could hold the ports, but instead we will just connect to ports
  // immediately on the connect event and disconnect on the disconnect event
  const ports = await navigator.serial.getPorts();

  ports.forEach((port) => {
    addPairing(port); // update pairings list
  });
});

/**
 * This is used to wait for user activation if no ports are accessible.
 * https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API#specifications
 */
document.getElementById('pair').addEventListener('click', async () => {
  // filtering: https://wicg.github.io/serial/#serialportfilter-dictionary

  try {
    const port = await navigator.serial.requestPort({
      filters: [{ usbProductId: USB_PRODUCT_ID, usbVendorId: USB_VENDOR_ID }],
    });
    addPairing(port); // update pairings list
  } catch (e) {
    console.debug('Failed to request port');
    console.debug(e);
  }
});

/**
 * Opens the port for reading/writing.
 * @param {SerialPort} port
 */
const openPort = async (port) => {
  await port.open({ baudRate: BAUD_RATE });

  // set text encoder
  const textEncoder = new TextEncoderStream();
  const writableDone = textEncoder.readable.pipeTo(port.writable);
  const writer = textEncoder.writable.getWriter();

  const textDecoder = new TextDecoderStream();
  const readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
  const reader = textDecoder.readable.getReader();

  // settings message
  await writer.write('$$\n');
  await writer.close();
  await writableDone;

  let stopped = false;
  while (port.readable && !stopped) {
    try {
      while (!stopped) {
        const { value, done } = await reader.read();
        console.debug({ value, done });
        if (done) {
          writeToConsole('\n');
          stopped = true;
          continue;
        }

        writeToConsole(value);

        // we are done if we read 'ok' for the $$ message
        if (value.trim().endsWith('ok')) {
          writeToConsole('\n');
          stopped = true;
          continue;
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      reader.cancel();

      // we just blindly catch this error because it doesn't
      // actually do anything (it's an undefined error????)
      await readableStreamClosed.catch((_) => {});
    }
  }

  reader.releaseLock();
  writer.releaseLock();
};

/**
 * Closes port for reading/writing.
 * @param {SerialPort} port
 */
const closePort = async (port) => {
  await port.close();
};

/**
 * Forget paired port.
 * @param {SerialPort} port
 */
const forgetPort = async (port) => {
  await port.forget();
};

/**
 * This event must be attached to all pairing DOM objects in the
 * createPairingListing function (below).
 */
const pairingClickEvent = async (e) => {
  const usbProductId = parseInt(e.target.innerText);
  const ports = await navigator.serial.getPorts();
  const clickedPort = ports.filter(
    (port) => port.getInfo().usbProductId === usbProductId
  )[0]; // NOTE: no sanity check here

  // assuming no errors, we should toggle this class
  e.target.classList.toggle('open');

  try {
    // NOTE: condition feels inverted because we toggle the class
    //       directly above
    if (!e.target.classList.contains('open')) {
      // open ports must close
      await closePort(clickedPort);
    } else {
      // closed ports must open
      await openPort(clickedPort);
    }
  } catch (err) {
    console.error(err);

    // ensure CSS class matches the real state of port
    if (isOpen(clickedPort)) {
      e.target.classList.add('open');
    } else {
      e.target.classList.remove('open');
    }
  }
};

/**
 * This event must be attached to all pairing DOM objects in the
 * createPairingListing function (below).
 */
const pairingRightClickEvent = async (e) => {
  const usbProductId = parseInt(e.target.innerText);
  const ports = await navigator.serial.getPorts();
  const clickedPort = ports.filter(
    (port) => port.getInfo().usbProductId === usbProductId
  )[0]; // NOTE: no sanity check here

  try {
    await forgetPort(clickedPort);
    removePairing(clickedPort);
  } catch (err) {
    console.error(err);
  }
};

/////////////////////////////
/// CONNECTION UTILITIES  ///
/////////////////////////////

/**
 * Add a pairing to the list of pairings.
 * @param {SerialPort} port
 */
const addPairing = (port) => {
  document.getElementById('pairings').appendChild(createPairingListing(port));
};

/**
 *
 * @param {SerialPort} port
 * @returns A DOM Node for the list item to add to the pairings list.
 */
const createPairingListing = (port) => {
  const usbProductId = port.getInfo().usbProductId;
  const pairing = document.createElement('li');
  pairing.classList.add('paired-list-item');

  // if the port is open, we colour it green
  if (isOpen(port)) {
    pairing.classList.add('open');
  }

  pairing.id = `paired-${usbProductId}`;
  pairing.innerText = usbProductId;

  pairing.addEventListener('click', pairingClickEvent);
  pairing.addEventListener('contextmenu', pairingRightClickEvent);
  return pairing;
};

/**
 *
 * @param {SerialPort} port
 */
const removePairing = (port) => {
  document.getElementById(`paired-${port.getInfo().usbProductId}`).remove();
};

/**
 * Infers whether the port is open by using the readable and
 * writable fields of the SerialPort object.
 * @param {SerialPort} port
 * @returns {bool} Boolean for whether port is open.
 */
const isOpen = (port) => port.readable && port.writable;

/////////////////////////////
///     COMMUNICATION     ///
/////////////////////////////

const READ_INTERVAL = 2000; // 2 seconds

/**
 * Clear the console.
 */
document.getElementById('clear').addEventListener('click', () => {
  document.getElementById('console').innerText = '';
});

const directions = ['xplus', 'xminus', 'yplus', 'yminus', 'zplus', 'zminus'];

directions.forEach((direction) => {
  document.getElementById(direction).addEventListener('click', async () => {
    // TODO: implement actual signals
    console.debug('Clicked ' + direction);
  });
});

/////////////////////////////
/// COMMUNICATION UTILITY ///
/////////////////////////////

/**
 *
 * @param {String} log
 */
const writeToConsole = (log) => {
  const console = document.getElementById('console');
  console.value += log;
};
