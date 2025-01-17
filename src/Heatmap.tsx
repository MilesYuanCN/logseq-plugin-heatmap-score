import {
  addDays,
  addWeeks,
  differenceInDays,
  endOfWeek,
  startOfWeek,
} from "date-fns";
import { ErrorBoundary, FallbackProps } from "react-error-boundary";

import * as React from "react";
import CalendarHeatmap from "react-calendar-heatmap";
import ReactTooltip from "react-tooltip";
import { useMountedState, useWindowSize } from "react-use";
import "./Heatmap.css";
import {
  formatAsDashed,
  formatAsLocale,
  formatAsParam,
  triggerIconName,
  parseJournalDate,
  useCurrentJournalDate,
} from "./utils";

function ErrorFallback({ error }: FallbackProps) {
  return (
    <div role="alert" className="text-red-500 font-semibold">
      <p>
        Heatmap failed to render. Can you re-index your graph and try again?
      </p>
    </div>
  );
}

const useActivities = (startDate: string, endDate: string) => {
  const isMounted = useMountedState();
  const currentJournalDate = useCurrentJournalDate();

  const [rawValue, setRawValue] = React.useState<any[]>([]);

  React.useLayoutEffect(() => {
    (async () => {
      const date0 = new Date(startDate);
      const date1 = new Date(endDate);

      const res: any[] = await logseq.DB.datascriptQuery(`
        [:find (pull ?p [*]) ?score
         :where
         [?b :block/page ?p]
         [?p :block/journal? true]
         [?p :block/journal-day ?d]
         [?b :block/path-refs [:block/name "daily_statistic"]]
         (not (?b :block/content "#daily_statistic"))
         [?b :block/content ?score]
         [(>= ?d ${formatAsParam(date0)})]
         [(<= ?d ${formatAsParam(date1)})]]
     `);

      if (isMounted()) {
        setRawValue(res);
      }
    })();
  }, [startDate, endDate]);

  return React.useMemo(() => {
    const date0 = new Date(startDate);
    const date1 = new Date(endDate);

    const datumMap = new Map<string, Datum>();
    rawValue.forEach(([page, scoreStr]: any[]) => {
      const date = formatAsDashed(parseJournalDate(page["journal-day"]));
      // 将形如 "#work_done_score : 2" 的字符串转换为 2
      var score = parseInt(scoreStr.split(":")[1].trim());
      if (!(score > 0)) {
        score = 0;
      }
      var oldScore = 0
      if (datumMap.has(date)) {
        oldScore = datumMap.get(date)!.score;
      }
      const newDatum = {
        score: score + oldScore,
        date: formatAsDashed(date),
        originalName: page["original-name"] as string,
      };
      datumMap.set(date, newDatum);
    });


    const mapping = Object.fromEntries(datumMap.entries());

    const totalDays = differenceInDays(date1, date0) + 1;
    const newValues: Datum[] = [];
    for (let i = 0; i < totalDays; i++) {
      const date = formatAsDashed(addDays(date0, i));
      if (mapping[date]) {
        newValues.push(mapping[date]);
      } else {
        newValues.push({
          date,
          score: 0,
          originalName: formatAsLocale(date),
        });
      }
    }

    if (currentJournalDate) {
      const datum = newValues.find(
        (v) => formatAsDashed(currentJournalDate) === v.date
      );
      if (datum) {
        datum.isActive = true;
      }
    }
    return newValues;
  }, [rawValue, currentJournalDate]);
};

type Datum = {
  date: string;
  originalName: string;
  score: number;
  isActive?: boolean;
};

// We have 0 ~ 6 scales for now:
// 0 -> 0
// [1,  40] -> 1
// [41, 60] -> 2
// [61, 70] -> 3
// [71, 80] -> 4
// [81, 90] -> 5
// [91, 100] -> 6
// [101, 00] -> 1000
// [-00, -1] -> 1000

const scaleCount = (v: number) => {
  if (v < 0) {
    return 1000;
  } else if (v == 0) {
    return 0;
  } else if (v < 40) {
    return 1;
  } else if (v < 60) {
    return 2;
  } else if (v < 70) {
    return 3;
  } else if (v < 80) {
    return 4;
  } else if (v < 90) {
    return 5;
  } else if (v <= 100) {
    return 6;
  } else {
    return 1000;
  }  
};

const getTooltipDataAttrs = (value: Datum) => {
  // Temporary hack around null value.date issue
  if (!value || !value.date) {
    return null;
  }
  // Configuration for react-tooltip
  const count = value.score === 0 ? "No" : value.score;
  return {
    "data-tip": `<strong>${count} score</strong> on <span class="opacity-70">${value.originalName}</span>`,
  };
};

const useUpdateCounter = (v: any) => {
  const [state, setState] = React.useState(0);
  React.useEffect(() => {
    setState((c) => c + 1);
  }, [v]);
  return state;
};

const HeatmapChart = ({
  today,
  startDate,
  endDate,
}: {
  startDate: string;
  endDate: string;
  today: string;
}) => {
  const activities = useActivities(startDate, endDate);
  const counter = useUpdateCounter(activities);
  const weeks = Math.ceil(activities.length / 7);
  const totalScore = activities.reduce((acc, cur) => acc + +cur.score, 0);
  return (
    <div style={{ width: `${weeks * 16}px` }}>
      <CalendarHeatmap
        startDate={startDate}
        endDate={endDate}
        values={activities}
        showOutOfRangeDays
        classForValue={(value: Datum) => {
          let classes: string[] = [];
          classes.push(`color-github-score-${scaleCount(value?.score ?? 0)}`);
          if (today === value?.date) {
            classes.push("today");
          }
          if (value?.isActive) {
            classes.push("active");
          }
          return classes.join(" ");
        }}
        tooltipDataAttrs={getTooltipDataAttrs}
        onClick={(d: Datum) => {
          if (d) {
            logseq.App.pushState("page", { name: d.originalName });
            // Allow the user to quickly navigate between different days
            // logseq.hideMainUI();
          }
        }}
        gutterSize={4}
        transformDayElement={(rect) => {
          return React.cloneElement(rect, { rx: 3 });
        }}
      />
      <div className="text-xs text-right mt-1">
        Average score during this period:{" "}
        <span className="font-medium">
          {new Intl.NumberFormat().format(totalScore/activities.length)}
        </span>
      </div>
      <ReactTooltip key={counter} effect="solid" html />
    </div>
  );
};

const NUM_WEEKS = 16; // Half a year

const DateRange = ({
  range,
  onRangeChange,
  today,
}: {
  range: [string, string] | null;
  onRangeChange: (r: [string, string]) => void;
  today: string;
}) => {
  React.useLayoutEffect(() => {
    if (!range) {
      const endDate = formatAsDashed(endOfWeek(new Date(today)));
      const startDate = formatAsDashed(
        startOfWeek(addWeeks(endOfWeek(new Date(today)), -NUM_WEEKS))
      );
      onRangeChange([startDate, endDate]);
    }
  }, [range]);

  const onRangeClick = (isPrev: boolean) => {
    const [, endDate] = range!;
    const newEndDate = formatAsDashed(
      addWeeks(new Date(endDate), isPrev ? -12 : 12)
    );

    const newStartDate = formatAsDashed(
      startOfWeek(addWeeks(new Date(newEndDate), -NUM_WEEKS))
    );

    onRangeChange([newStartDate, newEndDate]);
  };

  if (range) {
    const [startDate, endDate] = range;
    return (
      <div className="text-xs mb-2">
        From
        <span className="date-range-tag" onClick={() => onRangeClick(true)}>
          {formatAsLocale(startDate)}
        </span>
        to
        <span className="date-range-tag" onClick={() => onRangeClick(false)}>
          {formatAsLocale(endDate)}
        </span>
      </div>
    );
  }
  return null;
};

function useIconPosition() {
  const windowSize = useWindowSize();
  return React.useMemo(() => {
    let right = windowSize.width - 10;
    let bottom = 20;
    if (top?.document) {
      const iconRect = top?.document
        .querySelector(`.${triggerIconName}`)
        ?.getBoundingClientRect();
      if (iconRect) {
        right = iconRect.right;
        bottom = iconRect.bottom;
      }
    }
    return { right, bottom };
  }, [windowSize]);
}

export const Heatmap = React.forwardRef<HTMLDivElement>(({ }, ref) => {
  const today = formatAsDashed(new Date());
  const [range, setRange] = React.useState<[string, string] | null>(null);
  const { bottom, right } = useIconPosition();
  return (
    <div
      ref={ref}
      className="heatmap-root"
      style={{ left: right - 300, top: bottom + 20 }}
    >
      <ErrorBoundary FallbackComponent={ErrorFallback}>
        <DateRange range={range} onRangeChange={setRange} today={today} />
        {range && (
          <HeatmapChart today={today} endDate={range[1]} startDate={range[0]} />
        )}
      </ErrorBoundary>
    </div>
  );
});
