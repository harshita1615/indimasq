/**
 * Runs in the chat page's own JavaScript world, before the page's scripts.
 *
 * Many sites open the file picker with a file input they create in code and
 * never add to the page. Events on such an input never reach the page, so
 * IndiMasq's content script cannot see the chosen image. When a detached file
 * input opens its picker, this adds it to the page, hidden, so its events can
 * be checked like any other. Nothing else is touched, read or sent.
 */

const HOLDER = "indimasq-file-holder";

function adopt(input: HTMLInputElement): void {
  if (input.isConnected || input.type !== "file") return;
  let holder = document.getElementById(HOLDER);
  if (!holder) {
    holder = document.createElement("div");
    holder.id = HOLDER;
    holder.hidden = true;
    (document.body ?? document.documentElement).append(holder);
  }
  // One adopted input at a time: the previous picker is finished with.
  holder.replaceChildren(input);
}

const click = HTMLInputElement.prototype.click;
HTMLInputElement.prototype.click = function (this: HTMLInputElement) {
  adopt(this);
  return click.call(this);
};

const showPicker = HTMLInputElement.prototype.showPicker;
if (showPicker) {
  HTMLInputElement.prototype.showPicker = function (this: HTMLInputElement) {
    adopt(this);
    return showPicker.call(this);
  };
}
