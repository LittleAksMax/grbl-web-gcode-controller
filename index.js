/////////////////////////////
///    GENERAL UTILITY    ///
/////////////////////////////

/**
 * This function is supposed to make adding click events to specific
 * buttons more concise.
 * NOTE: this is a ChatGPT'd JavaDoc
 * @template Args extends any[]
 * @param {string} id
 * @param {(e: MouseEvent, ...args: Args) => Promise<void>} f
 * @param {...Args} args
 */
const addClick = (id, f, ...args) => {
  document
    .getElementById(id)
    .addEventListener('click', async (e) => f(e, ...args));
};

/**
 * Send a single command to the machine through the serial port.
 * @param {SerialPort} port
 * @param {string} command
 */
const ping = async (port, command) => {
  // obtain writer for command
  const textEncoder = new TextEncoderStream();
  const writableDone = textEncoder.readable.pipeTo(port.writable);
  const writer = textEncoder.writable.getWriter();

  // obtain reader
  const textDecoder = new TextDecoderStream();
  const readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
  const reader = textDecoder.readable.getReader();

  // settings message
  await writer.write(`${command}\n`); // NOTE: I don't know if \n is necessary
  await writer.close();
  await writableDone;

  let stopped = false;
  while (port.readable && !stopped) {
    try {
      while (!stopped) {
        const { value, done } = await reader.read();
        if (done) {
          writeToConsole('\n');
          stopped = true;
          continue;
        }

        writeToConsole(value);

        // we separate ok and error for clarity (despite equivalent handling)
        // TODO: error message detection is not be accurate at all
        // https://github.com/grbl/grbl/wiki//Interfacing-with-Grbl#grbl-response-meanings
        if (value.trim().endsWith('ok')) {
          writeToConsole('\n');
          stopped = true;
          continue;
        } else if (value.trim().endsWith('error')) {
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

const getOpenPort = async () => {
  const openPorts = document.getElementsByClassName('open');
  if (openPorts.length === 0) {
    return null;
  }
  const firstOpenPortUsbProductId = parseInt(openPorts[0].innerText);

  const ports = await navigator.serial.getPorts();
  const port = ports.filter(
    (port) => port.getInfo().usbProductId === firstOpenPortUsbProductId
  )[0]; // NOTE: no sanity check here

  return port;
};

/////////////////////////////
/// CONNECTION MANAGEMENT ///
/////////////////////////////

const BAUD_RATE = 115200; // hard-coded for machine
const USB_PRODUCT_ID = 29987; // hard-coded for machine
const USB_VENDOR_ID = 6790; // hard-coded for machine

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
addClick('pair', async (_) => {
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

  await ping(port, '$$');
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

/**
 * G-Code commands list
 * https://cncphilosophy.com/grbl-g-code-commands-list/
 */

const READ_INTERVAL = 2000; // 2 seconds

/**
 * Clear the console.
 */
addClick('clear', () => {
  document.getElementById('console').value = '';
});

const directions = ['xplus', 'xminus', 'yplus', 'yminus', 'zplus', 'zminus'];

directions.forEach((direction) => {
  addClick(direction, async (_) => {
    const port = await getOpenPort();

    // no port open
    if (!port) {
      return;
    }

    // infer appropriate axis
    // NOTE: no sanity check for validity of axis
    const axis = direction.charAt(0).toUpperCase();
    // get appropriate stepsize
    const stepsize = getStepSize() * (direction.endsWith('minus') ? -1 : 1);

    // send message
    // G91 - relative mode; G90 - absolute mode
    await ping(port, `G91\nG0 ${axis}${stepsize}\nG90\n`);
  });
});

addClick('zorigin', async (_) => {
  const port = await getOpenPort();

  // no port open
  if (!port) {
    return;
  }

  await ping(port, 'G92 Z0\n');
});

addClick('xyorigin', async (_) => {
  const port = await getOpenPort();

  // no port open
  if (!port) {
    return;
  }

  await ping(port, 'G92 X0 Y0\n');
});

addClick('reset', async (_) => {
  const port = await getOpenPort();

  // no port open
  if (!port) {
    return;
  }

  // G92.1 - clears offsets
  await ping(port, 'G92.1\nG10 L2 P1 X0 Y0 Z0\n');
});

addClick('home', async (_) => {
  const port = await getOpenPort();

  // no open port
  if (!port) {
    return;
  }

  await ping(port, '$H');
});

addClick('ztouchplate', async (_) => {
  // TODO: nothing to implement here
  console.debug('Clicked ztouchplate');
});

addClick('drive', async (_) => {
  const port = await getOpenPort();
  const [x, y] = getAbsoluteCoords();

  await ping(port, `G90\nG0 X${x} Y${y}`);
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

/**
 *
 * @returns {number} The number in the #stepsize dropdown.
 */
const getStepSize = () => {
  const stepsizes = document.getElementById('stepsize');
  const value = parseFloat(stepsizes.options[stepsizes.selectedIndex].value);
  return value;
};

/**
 *
 * @returns {number[]} The values in the 2 input boxes for
 *                     driving to absolute positions.
 */
const getAbsoluteCoords = () => {
  const x = parseInt(document.getElementById('xabs').value);
  const y = parseInt(document.getElementById('yabs').value);
  return [x, y];
};
