/**
 * A phone held sideways gets the map full screen (the tab bar and header hide).
 * Portrait phones and iPads (landscape height well over 600pt) keep the whole
 * Operations page, with the map section inside its scroll view.
 */
export function isOperationsLandscape(width: number, height: number) {
  return width > height && height < 600;
}
